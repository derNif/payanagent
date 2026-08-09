import { NextRequest, NextResponse } from "next/server";
import { getConvexClient, requirePlatformSecret } from "@/lib/convex";
import { authenticateRequest } from "@/lib/auth";
import { jsonError } from "@/lib/api-http";
import { validateBody, cancelSchema } from "@/lib/validation";
import { payoutEscrow } from "@/lib/escrow-release";
import {
  isUpstreamUnavailable,
  logError,
  lookupErrorResponse,
  upstreamUnavailableResponse,
} from "@/lib/errors";
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

  const { secret: platformSecret, error: secretError } = requirePlatformSecret();
  if (secretError) return secretError;

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
  } catch (err) {
    return lookupErrorResponse(
      "requests.cancel:get-request",
      err,
      "Invalid request ID",
      { requestId },
    );
  }
  if (!req) {
    return jsonError("Request not found", 404);
  }
  if (req.buyerId !== agent._id) {
    return jsonError("Only the buyer can cancel", 403);
  }
  const cancellable = ["open", "accepted", "fulfilled"];
  if (!cancellable.includes(req.status)) {
    return jsonError(`Cannot cancel a request in status: ${req.status}`, 400);
  }
  // Once work is delivered, the buyer can't instantly cancel-refund and walk
  // off with the deliverable — the provider gets a protection window. After it,
  // cancel remains an escape hatch (e.g. a non-delivering "fulfilled" that's
  // actually junk). The buyer's normal path from `fulfilled` is /approve.
  const DELIVERY_PROTECTION_MS = 7 * 24 * 60 * 60 * 1000;
  if (
    req.status === "fulfilled" &&
    req.fulfilledAt &&
    Date.now() - req.fulfilledAt < DELIVERY_PROTECTION_MS
  ) {
    return jsonError(
      "Work has been delivered — approve it, or wait out the 7-day provider-protection window before cancelling.",
      403,
    );
  }

  // No escrow → straight cancel
  if (!req.escrow) {
    await convex.mutation(api.requests.markCancelled, {
      platformSecret,
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
    return jsonError("Buyer has no wallet address configured", 400);
  }

  // Acquire the atomic settlement lock BEFORE the on-chain refund so concurrent
  // cancel/cancel or cancel/approve can't double-spend the platform wallet.
  try {
    await convex.mutation(api.requests.claimForSettlement, {
        platformSecret,
      requestId: req._id,
      allowedFrom: ["open", "accepted", "fulfilled"],
    });
  } catch (err) {
    // The lock is only "held" if Convex actually answered. A transport failure
    // here is ours, and reporting it as a 409 would tell the buyer their cancel
    // is in flight when nothing was ever claimed.
    logError("requests.cancel:claim-settlement", err, { requestId: req._id });
    if (isUpstreamUnavailable(err)) return upstreamUnavailableResponse();
    return jsonError("Request is already being settled", 409);
  }

  // Idempotency: if a release/refund already touched funds, never transfer
  // again. A pending receipt = a prior attempt's transfer may be in flight —
  // refunding again could double-pay, so 409 and reconcile from its txHash.
  const existing = await convex.query(api.receipts.getSettlementForRequest, {
    requestId: req._id,
  });
  if (existing && existing.status === "pending") {
    logError("requests.cancel:pending-settlement", "prior payout unresolved", {
      requestId: req._id,
      receiptId: existing._id,
      txHash: existing.txHash,
    });
    return jsonError(
      "A prior escrow payout for this request is unresolved (pending). Not retrying automatically to avoid a double payout.",
      409,
      { receiptId: existing._id, txHash: existing.txHash || undefined },
    );
  }
  if (existing) {
    await convex.mutation(api.requests.markCancelled, {
      platformSecret,
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

  // The pending receipt is written BEFORE the transfer (inside payoutEscrow),
  // so a crash after funds move can never lead a retry to refund twice.
  const refund = await payoutEscrow({
    convex,
    platformSecret,
    buyerId: req.buyerId,
    sellerId: req.providerId ?? req.buyerId,
    requestId: req._id,
    toAddress: buyer.walletAddress,
    amountCents: refundAmount,
    settlementType: "escrow_refund",
    startedAt,
  });
  if (!refund.ok) {
    await convex.mutation(api.requests.revertSettlement, { platformSecret, requestId: req._id });
    return jsonError(`Refund failed: ${refund.error}`, 502);
  }
  const receiptId = refund.receiptId;

  await convex.mutation(api.requests.markCancelled, {
      platformSecret,
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
