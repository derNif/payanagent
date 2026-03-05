import { NextRequest, NextResponse } from "next/server";
import { getConvexClient } from "@/lib/convex";
import { authenticateRequest } from "@/lib/auth";
import { getFacilitatorUrl, getNetwork, getNetworkId, releaseEscrow } from "@/lib/x402";
import { api } from "@convex/_generated/api";
import { Id } from "@convex/_generated/dataModel";

// POST /api/v1/requests/:requestId/complete — Client approves deliverable, releases payment
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ requestId: string }> }
) {
  const { agent, error } = await authenticateRequest(request);
  if (error) return error;

  const { requestId } = await params;
  const convex = getConvexClient();

  try {
    const job = await convex.query(api.jobs.getById, {
      jobId: requestId as Id<"jobs">,
    });

    if (!job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    if (job.clientAgentId !== agent._id) {
      return NextResponse.json(
        { error: "Only the client can approve and complete the job" },
        { status: 403 }
      );
    }

    if (job.status !== "delivered") {
      return NextResponse.json(
        { error: `Job must be in 'delivered' status. Current: ${job.status}` },
        { status: 400 }
      );
    }

    // Atomic lock: transition delivered → completing (prevents double-spend)
    try {
      await convex.mutation(api.jobs.markCompleting, {
        jobId: requestId as Id<"jobs">,
      });
    } catch {
      return NextResponse.json(
        { error: "Job completion already in progress" },
        { status: 409 }
      );
    }

    // Get provider wallet address for on-chain transfer
    const provider = await convex.query(api.agents.getById, {
      agentId: job.providerAgentId!,
    });
    if (!provider?.walletAddress) {
      // Revert lock on failure
      await convex.mutation(api.jobs.revertToDelivered, {
        jobId: requestId as Id<"jobs">,
      });
      return NextResponse.json(
        { error: "Provider has no wallet address configured" },
        { status: 400 }
      );
    }

    // Transfer USDC from platform wallet to provider on-chain
    const escrowResult = await releaseEscrow(
      provider.walletAddress,
      job.agreedPriceCents!
    );

    // If on-chain transfer failed, revert status and report error
    if (!escrowResult.success) {
      await convex.mutation(api.jobs.revertToDelivered, {
        jobId: requestId as Id<"jobs">,
      });
      return NextResponse.json(
        { error: `Escrow release failed: ${escrowResult.error}` },
        { status: 500 }
      );
    }

    // Record the settlement transaction
    const settlementTxId = await convex.mutation(api.transactions.create, {
      fromAgentId: job.clientAgentId,
      toAgentId: job.providerAgentId!,
      jobId: requestId as Id<"jobs">,
      amountCents: job.agreedPriceCents!,
      currency: "USDC",
      chain: getNetwork(),
      network: getNetworkId(),
      txHash: escrowResult.txHash,
      facilitatorUrl: getFacilitatorUrl(),
      type: "escrow_release",
      status: "confirmed",
      confirmedAt: Date.now(),
    });

    // Complete the job (completing → completed)
    await convex.mutation(api.jobs.complete, {
      jobId: requestId as Id<"jobs">,
      settlementTransactionId: settlementTxId,
    });

    // Update reputation counters
    await convex.mutation(api.agents.updateReputation, {
      agentId: job.providerAgentId!,
      jobCompleted: true,
      earned: job.agreedPriceCents,
    });

    await convex.mutation(api.agents.updateReputation, {
      agentId: job.clientAgentId,
      spent: job.agreedPriceCents,
    });

    return NextResponse.json({
      message: "Job completed. Payment released to provider.",
      requestId,
      settlementTransactionId: settlementTxId,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
