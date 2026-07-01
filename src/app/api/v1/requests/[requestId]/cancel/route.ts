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

// POST /api/v1/requests/:requestId/cancel — Buyer cancels.
// v0.2 path.
//
// Allowed: status ∈ {open, accepted, fulfilled} and caller is the buyer.
// If escrow=true: refund buyer's USDC on-chain via releaseEscrow,
//   emit escrow_refund receipt, link as settlementReceiptId.
// If escrow=false: just mark cancelled.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ requestId: string }> },
) {
  const startedAt = Date.now();

  // Fail fast on misconfiguration — never after money has moved.
  const platformSecret = process.env.PLATFORM_INTERNAL_KEY || "";
  if (!platformSecret) {
    return NextResponse.json(
      { error: "Platform misconfigured: missing PLATFORM_INTERNAL_KEY" },
      { status: 500 },
    );
  }

  const { agent, error } = await authenticateRequest(request);
  if (error) return error;

  const { data, error: validationError } = await validateBody(request, cancelSchema);
  if (validationError) return validationError;

  const { requestId } = await params;
  const convex = getConvexClient();

  let req;
  try {
    req = await convex.query(api.requests.getById, {
      requestId: requestId as Id<"requests">,
    });
  } catch {
    return NextResponse.json({ error: "Invalid request ID" }, { status: 400 });
  }
  if (!req) {
    return NextResponse.json({ error: "Request not found" }, { status: 404 });
  }
  if (req.buyerId !== agent._id) {
    return NextResponse.json(
      { error: "Only the buyer can cancel" },
      { status: 403 },
    );
  }
  const cancellable = ["open", "accepted", "fulfilled"];
  if (!cancellable.includes(req.status)) {
    return NextResponse.json(
      { error: `Cannot cancel a request in status: ${req.status}` },
      { status: 400 },
    );
  }

  // No escrow → straight cancel
  if (!req.escrow) {
    await convex.mutation(api.requests.markCancelled, {
      requestId: req._id,
      reason: data.reason,
    });
    return NextResponse.json({ ok: true, refunded: false });
  }

  // Escrow → refund + emit receipt
  const buyer = await convex.query(api.agents.getById, {
    agentId: req.buyerId,
  });
  if (!buyer?.walletAddress) {
    return NextResponse.json(
      { error: "Buyer has no wallet address configured" },
      { status: 400 },
    );
  }

  // Acquire the atomic settlement lock BEFORE the on-chain refund so concurrent
  // cancel/cancel or cancel/approve can't double-spend the platform wallet.
  try {
    await convex.mutation(api.requests.claimForSettlement, {
      requestId: req._id,
      allowedFrom: ["open", "accepted", "fulfilled"],
    });
  } catch {
    return NextResponse.json(
      { error: "Request is already being settled" },
      { status: 409 },
    );
  }

  // Idempotency: if a release/refund already moved funds, finalize without
  // transferring again.
  const existing = await convex.query(api.receipts.getSettlementForRequest, {
    requestId: req._id,
  });
  if (existing) {
    await convex.mutation(api.requests.markCancelled, {
      requestId: req._id,
      reason: data.reason,
      refundReceiptId: existing._id,
    });
    return NextResponse.json({
      ok: true,
      refunded: true,
      receiptId: existing._id,
      txHash: existing.txHash,
    });
  }

  // Refund the amount actually deposited (not the agreed price) so the surplus
  // on an open-request escrow isn't stranded.
  const refundAmount =
    req.escrowDepositedCents ?? req.agreedPriceCents ?? req.budgetMaxCents;

  const refund = await releaseEscrow(buyer.walletAddress, refundAmount);
  if (!refund.success || !refund.txHash) {
    await convex.mutation(api.requests.revertSettlement, { requestId: req._id });
    return NextResponse.json(
      { error: `Refund failed: ${refund.error || "unknown"}` },
      { status: 502 },
    );
  }

  const receiptId: Id<"receipts"> = await convex.mutation(
    api.receipts.recordSettlement,
    {
      platformSecret,
      buyerId: req.buyerId,
      sellerId: req.providerId ?? req.buyerId,
      requestId: req._id,
      amountCents: refundAmount,
      amountMicroUsd: refundAmount * 10000,
      currency: "USDC",
      chain: getNetwork(),
      network: getNetworkId(),
      txHash: refund.txHash,
      facilitatorUrl: getFacilitatorUrl(),
      settlementType: "escrow_refund",
      status: "confirmed",
      latencyMs: Date.now() - startedAt,
    },
  );

  await convex.mutation(api.requests.markCancelled, {
    requestId: req._id,
    reason: data.reason,
    refundReceiptId: receiptId,
  });

  return NextResponse.json({
    ok: true,
    refunded: true,
    receiptId,
    txHash: refund.txHash,
  });
}
