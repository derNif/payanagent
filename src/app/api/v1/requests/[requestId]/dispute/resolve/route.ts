import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { getConvexClient } from "@/lib/convex";
import { validateBody, resolveDisputeSchema } from "@/lib/validation";
import {
  getFacilitatorUrl,
  getNetwork,
  getNetworkId,
  releaseEscrow,
} from "@/lib/x402";
import { api } from "@convex/_generated/api";
import { Id } from "@convex/_generated/dataModel";

// POST /api/v1/requests/:requestId/dispute/resolve?key=ADMIN_KEY
//
// Admin-only (Board). Terminates a `disputed` job by either releasing escrow
// to the provider (resolution: "release") or refunding the client
// (resolution: "refund").
//
// Security model:
//   - ADMIN_KEY passed via ?key=... and compared in constant time.
//   - On-chain transfer uses the same `releaseEscrow(recipient, amount)` helper
//     as the normal complete + cancel flows — it is recipient-agnostic, and
//     the security gates are:
//       1. admin-key check (below)
//       2. status === "disputed" gate
//       3. atomic lock (`completing` or `cancelling`) before the transfer
//       4. revert-to-disputed on on-chain failure
//
// Events:
//   - release -> `job.completed` (via jobs.complete — fires to both parties)
//   - refund  -> `job.cancelled` (via jobs.cancel — fires to both parties)
//
// Phase 1: Board arbitrates manually. A future version may add a per-admin
// audit log; for now the transactions row + webhook timeline are authoritative.
function adminAuthorized(request: NextRequest): boolean {
  const adminKey = process.env.ADMIN_KEY;
  if (!adminKey) return false;
  const provided = request.nextUrl.searchParams.get("key") ?? "";
  const a = Buffer.from(adminKey);
  const b = Buffer.from(provided);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ requestId: string }> }
) {
  if (!adminAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { requestId } = await params;
  const convex = getConvexClient();

  const { data, error: validationError } = await validateBody(
    request,
    resolveDisputeSchema
  );
  if (validationError) return validationError;

  try {
    const job = await convex.query(api.jobs.getById, {
      jobId: requestId as Id<"jobs">,
    });
    if (!job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }
    if (job.status !== "disputed") {
      return NextResponse.json(
        { error: `Only 'disputed' jobs can be resolved. Current: ${job.status}` },
        { status: 400 }
      );
    }
    if (!job.agreedPriceCents) {
      return NextResponse.json(
        { error: "Disputed job has no agreed price — data integrity error" },
        { status: 500 }
      );
    }

    if (data.resolution === "release") {
      if (!job.providerAgentId) {
        return NextResponse.json(
          { error: "Cannot release: job has no provider" },
          { status: 400 }
        );
      }
      const provider = await convex.query(api.agents.getById, {
        agentId: job.providerAgentId,
      });
      if (!provider?.walletAddress) {
        return NextResponse.json(
          { error: "Provider has no wallet address configured" },
          { status: 400 }
        );
      }

      try {
        await convex.mutation(api.jobs.markCompleting, {
          jobId: requestId as Id<"jobs">,
        });
      } catch {
        return NextResponse.json(
          { error: "Dispute resolution already in progress" },
          { status: 409 }
        );
      }

      const release = await releaseEscrow(
        provider.walletAddress,
        job.agreedPriceCents
      );
      if (!release.success) {
        await convex.mutation(api.jobs.revertToDisputed, {
          jobId: requestId as Id<"jobs">,
        });
        return NextResponse.json(
          { error: `Escrow release failed: ${release.error}` },
          { status: 500 }
        );
      }

      const settlementTxId = await convex.mutation(api.transactions.create, {
        fromAgentId: job.clientAgentId,
        toAgentId: job.providerAgentId,
        jobId: requestId as Id<"jobs">,
        amountCents: job.agreedPriceCents,
        currency: "USDC",
        chain: getNetwork(),
        network: getNetworkId(),
        txHash: release.txHash,
        facilitatorUrl: getFacilitatorUrl(),
        type: "escrow_release",
        status: "confirmed",
        confirmedAt: Date.now(),
      });

      await convex.mutation(api.jobs.recordDisputeResolution, {
        jobId: requestId as Id<"jobs">,
        note: data.note,
      });

      await convex.mutation(api.jobs.complete, {
        jobId: requestId as Id<"jobs">,
        settlementTransactionId: settlementTxId,
      });

      await convex.mutation(api.agents.updateReputation, {
        agentId: job.providerAgentId,
        jobCompleted: true,
        earned: job.agreedPriceCents,
      });
      await convex.mutation(api.agents.updateReputation, {
        agentId: job.clientAgentId,
        spent: job.agreedPriceCents,
      });

      return NextResponse.json({
        message: "Dispute resolved: escrow released to provider.",
        requestId,
        resolution: "release",
        settlementTransactionId: settlementTxId,
        txHash: release.txHash,
        note: data.note,
      });
    }

    // resolution === "refund"
    const client = await convex.query(api.agents.getById, {
      agentId: job.clientAgentId,
    });
    if (!client?.walletAddress) {
      return NextResponse.json(
        { error: "Client has no wallet address configured" },
        { status: 400 }
      );
    }

    try {
      await convex.mutation(api.jobs.markCancelling, {
        jobId: requestId as Id<"jobs">,
      });
    } catch {
      return NextResponse.json(
        { error: "Dispute resolution already in progress" },
        { status: 409 }
      );
    }

    const refund = await releaseEscrow(
      client.walletAddress,
      job.agreedPriceCents
    );
    if (!refund.success) {
      await convex.mutation(api.jobs.revertToDisputed, {
        jobId: requestId as Id<"jobs">,
      });
      return NextResponse.json(
        { error: `Refund failed: ${refund.error}` },
        { status: 500 }
      );
    }

    const refundTxId = await convex.mutation(api.transactions.create, {
      fromAgentId: job.clientAgentId,
      toAgentId: job.clientAgentId,
      jobId: requestId as Id<"jobs">,
      amountCents: job.agreedPriceCents,
      currency: "USDC",
      chain: getNetwork(),
      network: getNetworkId(),
      txHash: refund.txHash,
      facilitatorUrl: getFacilitatorUrl(),
      type: "refund",
      status: "confirmed",
      confirmedAt: Date.now(),
    });

    await convex.mutation(api.jobs.recordDisputeResolution, {
      jobId: requestId as Id<"jobs">,
      note: data.note,
    });

    await convex.mutation(api.jobs.cancel, {
      jobId: requestId as Id<"jobs">,
    });

    return NextResponse.json({
      message: "Dispute resolved: escrow refunded to client.",
      requestId,
      resolution: "refund",
      refundTransactionId: refundTxId,
      txHash: refund.txHash,
      note: data.note,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
