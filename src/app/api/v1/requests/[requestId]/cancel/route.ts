import { NextRequest, NextResponse } from "next/server";
import { getConvexClient } from "@/lib/convex";
import { authenticateRequest } from "@/lib/auth";
import { validateBody, cancelSchema } from "@/lib/validation";
import {
  getFacilitatorUrl,
  getNetwork,
  getNetworkId,
  releaseEscrow,
} from "@/lib/x402";
import { api } from "@convex/_generated/api";
import { Id } from "@convex/_generated/dataModel";

// POST /api/v1/requests/:requestId/cancel
//
// Client-only. Only while status ∈ {open, accepted}.
//
// - Open direct-hire OR accepted job: escrow was deposited → refund USDC to client
//   wallet on-chain via releaseEscrow (same function used for release; it's
//   recipient-agnostic — the security property is enforced by the caller's
//   auth + job.status gate, not by a distinct helper).
// - Open marketplace job (no bid accepted yet, no escrow): no refund, just cancel.
//
// Flow when refund needed:
//   1. markCancelling (atomic lock — prevents double-refund)
//   2. on-chain USDC transfer to client wallet
//   3. record transactions row (type: refund)
//   4. jobs.cancel (fires job.cancelled webhook via scheduler)
//
// On on-chain failure, revertFromCancelling back to the previous status.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ requestId: string }> }
) {
  const { agent, error } = await authenticateRequest(request);
  if (error) return error;

  const { requestId } = await params;
  const convex = getConvexClient();

  const { data, error: validationError } = await validateBody(request, cancelSchema);
  if (validationError) return validationError;

  try {
    const job = await convex.query(api.jobs.getById, {
      jobId: requestId as Id<"jobs">,
    });

    if (!job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    if (job.clientAgentId !== agent._id) {
      return NextResponse.json(
        { error: "Only the client can cancel this job" },
        { status: 403 }
      );
    }

    if (job.status !== "open" && job.status !== "accepted") {
      return NextResponse.json(
        { error: `Cannot cancel job in status: ${job.status}` },
        { status: 400 }
      );
    }

    // Determine whether escrow needs to be refunded.
    // Escrow exists if: direct-hire job (paid at creation) OR accepted open job (paid at bid accept).
    const needsRefund =
      job.jobType === "direct" ||
      (job.jobType === "open" && job.status === "accepted");

    if (!needsRefund) {
      // No escrow deposited — straight cancel.
      await convex.mutation(api.jobs.cancel, {
        jobId: requestId as Id<"jobs">,
      });
      return NextResponse.json({
        message: "Job cancelled (no escrow to refund).",
        requestId,
        refunded: false,
      });
    }

    if (!job.agreedPriceCents) {
      return NextResponse.json(
        { error: "Job has no agreed price but is marked for refund — data integrity error" },
        { status: 500 }
      );
    }

    // Fetch client wallet address — refund destination.
    const client = await convex.query(api.agents.getById, {
      agentId: job.clientAgentId,
    });
    if (!client?.walletAddress) {
      return NextResponse.json(
        { error: "Client has no wallet address configured" },
        { status: 400 }
      );
    }

    // Remember pre-cancelling status so we can revert if refund fails.
    const previousStatus = job.status as "open" | "accepted";

    // Atomic lock: status → cancelling (prevents double-refund).
    try {
      await convex.mutation(api.jobs.markCancelling, {
        jobId: requestId as Id<"jobs">,
      });
    } catch {
      return NextResponse.json(
        { error: "Job cancellation already in progress" },
        { status: 409 }
      );
    }

    // Transfer USDC from platform wallet back to client wallet on-chain.
    // releaseEscrow is recipient-agnostic; it's the same ERC-20 transfer used for
    // release-to-provider. Caller authz + markCancelling lock are the security gates.
    const refundResult = await releaseEscrow(
      client.walletAddress,
      job.agreedPriceCents
    );

    if (!refundResult.success) {
      // Revert lock on failure.
      await convex.mutation(api.jobs.revertFromCancelling, {
        jobId: requestId as Id<"jobs">,
        toStatus: previousStatus,
      });
      return NextResponse.json(
        { error: `Refund failed: ${refundResult.error}` },
        { status: 500 }
      );
    }

    // Record the refund transaction.
    const refundTxId = await convex.mutation(api.transactions.create, {
      fromAgentId: job.clientAgentId, // symbolic — funds originate from platform wallet
      toAgentId: job.clientAgentId,
      jobId: requestId as Id<"jobs">,
      amountCents: job.agreedPriceCents,
      currency: "USDC",
      chain: getNetwork(),
      network: getNetworkId(),
      txHash: refundResult.txHash,
      facilitatorUrl: getFacilitatorUrl(),
      type: "refund",
      status: "confirmed",
      confirmedAt: Date.now(),
    });

    // Finalize: cancelling → cancelled. Fires job.cancelled webhook via scheduler.
    await convex.mutation(api.jobs.cancel, {
      jobId: requestId as Id<"jobs">,
    });

    return NextResponse.json({
      message: `Job cancelled. $${(job.agreedPriceCents / 100).toFixed(
        2
      )} USDC refunded to client.`,
      requestId,
      refunded: true,
      refundTransactionId: refundTxId,
      txHash: refundResult.txHash,
      reason: data.reason,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
