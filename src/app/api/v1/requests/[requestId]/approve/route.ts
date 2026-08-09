import { NextRequest, NextResponse } from "next/server";
import { getConvexClient, requirePlatformSecret } from "@/lib/convex";
import { authenticateRequest } from "@/lib/auth";
import { jsonError } from "@/lib/api-http";
import { buildPaymentRequiredResponse } from "@/lib/x402";
import { getPaymentSignature, settleSignedPayment } from "@/lib/x402-settle";
import { recordSettlementReceipt } from "@/lib/settlement";
import { payoutEscrow } from "@/lib/escrow-release";
import {
  isUpstreamUnavailable,
  logError,
  lookupErrorResponse,
  upstreamUnavailableResponse,
} from "@/lib/errors";
import { api } from "@convex/_generated/api";
import { Id } from "@convex/_generated/dataModel";

// POST /api/v1/requests/:requestId/approve — Buyer approves the fulfilled work.
// Escrow requests: releases escrow on-chain to the provider's wallet and emits
// an escrow_release receipt. Non-escrow requests: x402-gated — the buyer pays
// the provider directly (payTo = provider wallet) and a direct receipt is
// emitted. Either way the request is marked approved.
// v0.2 path. Replaces v1 /complete.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ requestId: string }> },
) {
  const startedAt = Date.now();

  const { secret: platformSecret, error: secretError } = requirePlatformSecret();
  if (secretError) return secretError;

  const { agent, error } = await authenticateRequest(request);
  if (error) return error;

  const { requestId } = await params;
  const convex = getConvexClient();

  let req;
  try {
    req = await convex.query(api.requests.getById, {
      requestId: requestId as Id<"requests">,
    });
  } catch (err) {
    return lookupErrorResponse(
      "requests.approve:get-request",
      err,
      "Invalid request ID",
      { requestId },
    );
  }
  if (!req) {
    return jsonError("Request not found", 404);
  }
  if (req.buyerId !== agent._id) {
    return jsonError("Only the buyer can approve", 403);
  }
  // `completing` is allowed through so a settlement that crashed mid-flight
  // (lock acquired, then the process died) can recover via the idempotency
  // check below instead of being stranded forever.
  if (req.status !== "fulfilled" && req.status !== "completing") {
    return jsonError(`Cannot approve a request in status: ${req.status}`, 400);
  }
  if (!req.providerId) {
    return jsonError("Request has no assigned provider", 500);
  }
  if (!req.agreedPriceCents) {
    return jsonError("Request has no agreed price", 500);
  }
  // Look up provider wallet
  const provider = await convex.query(api.agents.getById, {
    agentId: req.providerId,
  });
  if (!provider) {
    return jsonError("Provider not found", 500);
  }

  if (!req.escrow) {
    // Non-escrow approve: the buyer pays the provider directly via x402 at
    // approval time — payTo is the provider's wallet, the platform never
    // takes custody. Same trustless flow as direct offer buys.
    if (!provider.walletAddress) {
      return jsonError("Provider has no wallet address configured", 503);
    }

    const paymentSignature = getPaymentSignature(request);
    if (!paymentSignature) {
      // Just asking for the challenge — take no lock (a buyer who never returns
      // must not strand the request in `completing`).
      return buildPaymentRequiredResponse(
        req.agreedPriceCents,
        request.url,
        `Payment for request: ${req.title}`,
        provider.walletAddress,
      );
    }

    // We have a signed payment and are about to settle — acquire the same
    // atomic lock the escrow path uses, so two concurrent approve calls can't
    // both settle and double-charge the buyer.
    try {
      await convex.mutation(api.requests.claimForSettlement, {
        platformSecret,
        requestId: req._id,
        allowedFrom: ["fulfilled", "completing"],
      });
    } catch (err) {
      // A transport failure took no lock — saying "already being settled" would
      // describe a claim that never happened.
      logError("requests.approve:claim-settlement-direct", err, {
        requestId: req._id,
      });
      if (isUpstreamUnavailable(err)) return upstreamUnavailableResponse();
      return jsonError("Request is already being settled", 409);
    }
    // If a prior attempt already recorded a settlement, finalize idempotently.
    const priorDirect = await convex.query(api.receipts.getSettlementForRequest, {
      requestId: req._id,
    });
    if (priorDirect) {
      await convex.mutation(api.requests.markApproved, {
        platformSecret,
        requestId: req._id,
        settlementReceiptId: priorDirect._id,
      });
      return NextResponse.json({
        ok: true,
        receiptId: priorDirect._id,
        txHash: priorDirect.txHash,
      });
    }

    // Any pre-settlement failure must release the lock back to `fulfilled`,
    // else a bad/late payment attempt strands the request in `completing`.
    const settlement = await settleSignedPayment({
      request,
      paymentSignature,
      amountCents: req.agreedPriceCents,
      payTo: provider.walletAddress,
      onFailure: () =>
        convex.mutation(api.requests.revertSettlement, {
          platformSecret,
          requestId: req._id,
        }),
    });
    if (!settlement.ok) return settlement.response;

    const receiptId = await recordSettlementReceipt(convex, {
      platformSecret,
      buyerId: req.buyerId,
      sellerId: req.providerId,
      requestId: req._id,
      amountCents: req.agreedPriceCents,
      amountMicroUsd: req.agreedPriceCents * 10000,
      txHash: settlement.txHash,
      settlementType: "direct",
      latencyMs: Date.now() - startedAt,
    });

    await convex.mutation(api.requests.markApproved, {
        platformSecret,
      requestId: req._id,
      settlementReceiptId: receiptId,
    });

    return NextResponse.json({
      ok: true,
      receiptId,
      txHash: settlement.txHash,
    });
  }

  if (!provider.walletAddress) {
    return jsonError("Provider has no wallet address configured", 503);
  }

  // Acquire the atomic settlement lock BEFORE any on-chain transfer. Convex
  // serializes this, so concurrent approve/approve or approve/cancel calls
  // can't both reach releaseEscrow and double-spend the shared platform wallet.
  try {
    await convex.mutation(api.requests.claimForSettlement, {
        platformSecret,
      requestId: req._id,
      allowedFrom: ["fulfilled", "completing"],
    });
  } catch (err) {
    logError("requests.approve:claim-settlement-escrow", err, {
      requestId: req._id,
    });
    if (isUpstreamUnavailable(err)) return upstreamUnavailableResponse();
    return jsonError("Request is already being settled", 409);
  }

  // Idempotency: if a release/refund already touched funds for this request,
  // never transfer again. A confirmed receipt finalizes; a PENDING one means a
  // prior attempt's transfer may be in flight or unaccounted — paying again
  // could double-release, so answer 409 and leave it to reconciliation (the
  // receipt carries the txHash to check on-chain).
  const existing = await convex.query(api.receipts.getSettlementForRequest, {
    requestId: req._id,
  });
  if (existing && existing.status === "pending") {
    logError("requests.approve:pending-settlement", "prior release unresolved", {
      requestId: req._id,
      receiptId: existing._id,
      txHash: existing.txHash,
    });
    return jsonError(
      "A prior escrow release for this request is unresolved (pending). Not retrying automatically to avoid a double payout.",
      409,
      { receiptId: existing._id, txHash: existing.txHash || undefined },
    );
  }
  if (existing) {
    await convex.mutation(api.requests.markApproved, {
        platformSecret,
      requestId: req._id,
      settlementReceiptId: existing._id,
    });
    return NextResponse.json({
      ok: true,
      receiptId: existing._id,
      txHash: existing.txHash,
    });
  }

  // Release the agreed price to the provider on-chain. The pending receipt is
  // written BEFORE the transfer (inside payoutEscrow), so a crash after funds
  // move can never lead a retry to pay twice.
  const payout = await payoutEscrow({
    convex,
    platformSecret,
    buyerId: req.buyerId,
    sellerId: req.providerId,
    requestId: req._id,
    toAddress: provider.walletAddress,
    amountCents: req.agreedPriceCents,
    settlementType: "escrow_release",
    startedAt,
  });
  if (!payout.ok) {
    // Transfer failed cleanly — revert the lock so the buyer can retry.
    await convex.mutation(api.requests.revertSettlement, { platformSecret, requestId: req._id });
    return jsonError(`Escrow release failed: ${payout.error}`, 502);
  }
  const receiptId = payout.receiptId;
  const release = { txHash: payout.txHash };

  // Refund any surplus (deposited budget − agreed price) back to the buyer, so
  // an open request whose winning bid was below budget doesn't strand funds.
  const deposited = req.escrowDepositedCents ?? req.agreedPriceCents;
  const surplus = deposited - req.agreedPriceCents;
  let refundReceiptId: Id<"receipts"> | undefined;
  let refundTxHash: string | undefined;
  if (surplus > 0) {
    const buyer = await convex.query(api.agents.getById, { agentId: req.buyerId });
    if (buyer?.walletAddress) {
      const refund = await payoutEscrow({
        convex,
        platformSecret,
        buyerId: req.buyerId,
        sellerId: req.buyerId,
        requestId: req._id,
        toAddress: buyer.walletAddress,
        amountCents: surplus,
        settlementType: "escrow_refund",
        startedAt,
      });
      if (refund.ok) {
        refundTxHash = refund.txHash;
        refundReceiptId = refund.receiptId;
      }
    }
  }

  // Finalize: completing -> approved.
  await convex.mutation(api.requests.markApproved, {
        platformSecret,
    requestId: req._id,
    settlementReceiptId: receiptId,
  });

  // Surplus that couldn't be refunded on-chain sits in the platform wallet and
  // needs a manual retry — surface it plainly instead of silently swallowing it.
  const surplusPendingCents = surplus > 0 && !refundTxHash ? surplus : 0;

  return NextResponse.json({
    ok: true,
    receiptId,
    txHash: release.txHash,
    surplusRefundedCents: refundTxHash ? surplus : 0,
    surplusPendingCents,
    refundReceiptId,
    refundTxHash,
  });
}
