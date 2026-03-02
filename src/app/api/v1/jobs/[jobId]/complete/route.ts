import { NextRequest, NextResponse } from "next/server";
import { getConvexClient } from "@/lib/convex";
import { authenticateRequest, unauthorizedResponse } from "@/lib/auth";
import { getFacilitatorUrl, getNetwork, getNetworkId } from "@/lib/x402";
import { api } from "@convex/_generated/api";
import { Id } from "@convex/_generated/dataModel";

// POST /api/v1/jobs/:jobId/complete — Client approves deliverable, releases payment
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const agent = await authenticateRequest(request);
  if (!agent) return unauthorizedResponse();

  const { jobId } = await params;
  const convex = getConvexClient();

  try {
    const job = await convex.query(api.jobs.getById, {
      jobId: jobId as Id<"jobs">,
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

    // Record the settlement transaction (platform → provider)
    // In production, this would trigger an on-chain USDC transfer via viem
    const settlementTxId = await convex.mutation(api.transactions.create, {
      fromAgentId: job.clientAgentId,
      toAgentId: job.providerAgentId!,
      jobId: jobId as Id<"jobs">,
      amountCents: job.agreedPriceCents!,
      currency: "USDC",
      chain: getNetwork(),
      network: getNetworkId(),
      facilitatorUrl: getFacilitatorUrl(),
      type: "escrow_release",
      status: "confirmed",
      confirmedAt: Date.now(),
    });

    // Complete the job
    await convex.mutation(api.jobs.complete, {
      jobId: jobId as Id<"jobs">,
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
      jobId,
      settlementTransactionId: settlementTxId,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
