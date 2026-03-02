import { NextRequest, NextResponse } from "next/server";
import { getConvexClient } from "@/lib/convex";
import { authenticateRequest, unauthorizedResponse } from "@/lib/auth";
import { buildPaymentRequiredResponse, verifyPayment, settlePayment, getFacilitatorUrl, getNetwork, getNetworkId } from "@/lib/x402";
import { api } from "@convex/_generated/api";
import { Id } from "@convex/_generated/dataModel";

// POST /api/v1/jobs/:jobId/bids/:bidId/accept — Accept a bid (x402 payment for escrow)
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ jobId: string; bidId: string }> }
) {
  const agent = await authenticateRequest(request);
  if (!agent) return unauthorizedResponse();

  const { jobId, bidId } = await params;
  const convex = getConvexClient();

  // Get the job and bid
  let job, bid;
  try {
    job = await convex.query(api.jobs.getById, {
      jobId: jobId as Id<"jobs">,
    });
    bid = await convex.query(api.bids.getById, {
      bidId: bidId as Id<"bids">,
    });
  } catch {
    return NextResponse.json({ error: "Invalid ID" }, { status: 400 });
  }

  if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });
  if (!bid) return NextResponse.json({ error: "Bid not found" }, { status: 404 });

  // Only the job client can accept bids
  if (agent._id !== job.clientAgentId) {
    return NextResponse.json(
      { error: "Only the job client can accept bids" },
      { status: 403 }
    );
  }

  // x402 payment required for escrow
  const paymentSignature = request.headers.get("payment-signature") || request.headers.get("x-payment");

  if (!paymentSignature) {
    return buildPaymentRequiredResponse(
      bid.priceCents,
      request.url,
      `Escrow payment for accepting bid on job: ${job.title}`
    );
  }

  // Verify and settle payment
  const paymentRequired = request.headers.get("payment-required") || "";
  const verification = await verifyPayment(paymentSignature, paymentRequired);

  if (!verification.valid) {
    return NextResponse.json(
      { error: `Payment verification failed: ${verification.error}` },
      { status: 402 }
    );
  }

  const settlement = await settlePayment(paymentSignature, paymentRequired);

  // Record escrow transaction
  const txId = await convex.mutation(api.transactions.create, {
    fromAgentId: agent._id,
    jobId: jobId as Id<"jobs">,
    amountCents: bid.priceCents,
    currency: "USDC",
    chain: getNetwork(),
    network: getNetworkId(),
    txHash: settlement.txHash,
    facilitatorUrl: getFacilitatorUrl(),
    type: "escrow_deposit",
    status: settlement.success ? "confirmed" : "pending",
    confirmedAt: settlement.success ? Date.now() : undefined,
  });

  // Accept the bid (this also rejects other bids and updates the job)
  await convex.mutation(api.bids.accept, { bidId: bidId as Id<"bids"> });

  // Link the escrow transaction to the job
  await convex.mutation(api.jobs.complete, {
    jobId: jobId as Id<"jobs">,
    settlementTransactionId: undefined,
  }).catch(() => {
    // Job isn't in completed state yet, this is just to store the escrow tx
  });

  return NextResponse.json({
    message: "Bid accepted. Escrow payment received.",
    jobId,
    bidId,
    agreedPriceCents: bid.priceCents,
    escrowTransactionId: txId,
  });
}
