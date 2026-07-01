import { NextRequest, NextResponse } from "next/server";
import { getConvexClient, PLATFORM_SECRET } from "@/lib/convex";
import { authenticateRequest } from "@/lib/auth";
import {
  buildPaymentRequiredResponse,
  verifyPayment,
  verifyPaymentIntegrity,
  settlePayment,
  releaseEscrow,
  getFacilitatorUrl,
  getNetwork,
  getNetworkId,
} from "@/lib/x402";
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
      { error: "Only the buyer can approve" },
      { status: 403 },
    );
  }
  // `completing` is allowed through so a settlement that crashed mid-flight
  // (lock acquired, then the process died) can recover via the idempotency
  // check below instead of being stranded forever.
  if (req.status !== "fulfilled" && req.status !== "completing") {
    return NextResponse.json(
      { error: `Cannot approve a request in status: ${req.status}` },
      { status: 400 },
    );
  }
  if (!req.providerId) {
    return NextResponse.json(
      { error: "Request has no assigned provider" },
      { status: 500 },
    );
  }
  if (!req.agreedPriceCents) {
    return NextResponse.json(
      { error: "Request has no agreed price" },
      { status: 500 },
    );
  }
  // Look up provider wallet
  const provider = await convex.query(api.agents.getById, {
    agentId: req.providerId,
  });
  if (!provider) {
    return NextResponse.json({ error: "Provider not found" }, { status: 500 });
  }

  if (!req.escrow) {
    // Non-escrow approve: the buyer pays the provider directly via x402 at
    // approval time — payTo is the provider's wallet, the platform never
    // takes custody. Same trustless flow as direct offer buys.
    if (!provider.walletAddress) {
      return NextResponse.json(
        { error: "Provider has no wallet address configured" },
        { status: 503 },
      );
    }

    const paymentSignature =
      request.headers.get("payment-signature") ||
      request.headers.get("x-payment");
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
        platformSecret: PLATFORM_SECRET,
        requestId: req._id,
        allowedFrom: ["fulfilled", "completing"],
      });
    } catch {
      return NextResponse.json(
        { error: "Request is already being settled" },
        { status: 409 },
      );
    }
    // If a prior attempt already recorded a settlement, finalize idempotently.
    const priorDirect = await convex.query(api.receipts.getSettlementForRequest, {
      requestId: req._id,
    });
    if (priorDirect) {
      await convex.mutation(api.requests.markApproved, {
        platformSecret: PLATFORM_SECRET,
        requestId: req._id,
        settlementReceiptId: priorDirect._id,
      });
      return NextResponse.json({
        ok: true,
        receiptId: priorDirect._id,
        txHash: priorDirect.txHash,
      });
    }

    const integrityCheck = verifyPaymentIntegrity(
      paymentSignature,
      req.agreedPriceCents,
      provider.walletAddress,
    );
    // Any pre-settlement failure must release the lock back to `fulfilled`,
    // else a bad/late payment attempt strands the request in `completing`.
    const releaseLock = () =>
      convex.mutation(api.requests.revertSettlement, {
        platformSecret: PLATFORM_SECRET,
        requestId: req._id,
      });

    if (!integrityCheck.valid) {
      await releaseLock();
      return NextResponse.json(
        { error: `Payment integrity check failed: ${integrityCheck.error}` },
        { status: 402 },
      );
    }

    const paymentRequired = request.headers.get("payment-required") || "";
    const verification = await verifyPayment(paymentSignature, paymentRequired);
    if (!verification.valid) {
      await releaseLock();
      return NextResponse.json(
        { error: `Payment verification failed: ${verification.error}` },
        { status: 402 },
      );
    }

    const settlement = await settlePayment(paymentSignature, paymentRequired);
    if (!settlement.success) {
      await releaseLock();
      return NextResponse.json(
        { error: `Payment settlement failed: ${settlement.error}` },
        { status: 402 },
      );
    }

    const receiptId: Id<"receipts"> = await convex.mutation(
      api.receipts.recordSettlement,
      {
        platformSecret,
        buyerId: req.buyerId,
        sellerId: req.providerId,
        requestId: req._id,
        amountCents: req.agreedPriceCents,
        amountMicroUsd: req.agreedPriceCents * 10000,
        currency: "USDC",
        chain: getNetwork(),
        network: getNetworkId(),
        txHash: settlement.txHash || "",
        facilitatorUrl: getFacilitatorUrl(),
        settlementType: "direct",
        status: "confirmed",
        latencyMs: Date.now() - startedAt,
      },
    );

    await convex.mutation(api.requests.markApproved, {
        platformSecret: PLATFORM_SECRET,
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
    return NextResponse.json(
      { error: "Provider has no wallet address configured" },
      { status: 503 },
    );
  }

  // Acquire the atomic settlement lock BEFORE any on-chain transfer. Convex
  // serializes this, so concurrent approve/approve or approve/cancel calls
  // can't both reach releaseEscrow and double-spend the shared platform wallet.
  try {
    await convex.mutation(api.requests.claimForSettlement, {
        platformSecret: PLATFORM_SECRET,
      requestId: req._id,
      allowedFrom: ["fulfilled", "completing"],
    });
  } catch {
    return NextResponse.json(
      { error: "Request is already being settled" },
      { status: 409 },
    );
  }

  // Idempotency: if a release/refund already moved funds for this request,
  // finalize without transferring again.
  const existing = await convex.query(api.receipts.getSettlementForRequest, {
    requestId: req._id,
  });
  if (existing) {
    await convex.mutation(api.requests.markApproved, {
        platformSecret: PLATFORM_SECRET,
      requestId: req._id,
      settlementReceiptId: existing._id,
    });
    return NextResponse.json({
      ok: true,
      receiptId: existing._id,
      txHash: existing.txHash,
    });
  }

  // Release the agreed price to the provider on-chain.
  const release = await releaseEscrow(provider.walletAddress, req.agreedPriceCents);
  if (!release.success || !release.txHash) {
    // Transfer failed — revert the lock so the buyer can retry.
    await convex.mutation(api.requests.revertSettlement, { platformSecret: PLATFORM_SECRET, requestId: req._id });
    return NextResponse.json(
      { error: `Escrow release failed: ${release.error || "unknown"}` },
      { status: 502 },
    );
  }

  // Emit escrow_release receipt
  const receiptId: Id<"receipts"> = await convex.mutation(
    api.receipts.recordSettlement,
    {
      platformSecret,
      buyerId: req.buyerId,
      sellerId: req.providerId,
      requestId: req._id,
      amountCents: req.agreedPriceCents,
      amountMicroUsd: req.agreedPriceCents * 10000,
      currency: "USDC",
      chain: getNetwork(),
      network: getNetworkId(),
      txHash: release.txHash,
      facilitatorUrl: getFacilitatorUrl(),
      settlementType: "escrow_release",
      status: "confirmed",
      latencyMs: Date.now() - startedAt,
    },
  );

  // Refund any surplus (deposited budget − agreed price) back to the buyer, so
  // an open request whose winning bid was below budget doesn't strand funds.
  const deposited = req.escrowDepositedCents ?? req.agreedPriceCents;
  const surplus = deposited - req.agreedPriceCents;
  let refundReceiptId: Id<"receipts"> | undefined;
  let refundTxHash: string | undefined;
  if (surplus > 0) {
    const buyer = await convex.query(api.agents.getById, { agentId: req.buyerId });
    if (buyer?.walletAddress) {
      const refund = await releaseEscrow(buyer.walletAddress, surplus);
      if (refund.success && refund.txHash) {
        refundTxHash = refund.txHash;
        refundReceiptId = await convex.mutation(api.receipts.recordSettlement, {
          platformSecret,
          buyerId: req.buyerId,
          sellerId: req.buyerId,
          requestId: req._id,
          amountCents: surplus,
          amountMicroUsd: surplus * 10000,
          currency: "USDC",
          chain: getNetwork(),
          network: getNetworkId(),
          txHash: refund.txHash,
          facilitatorUrl: getFacilitatorUrl(),
          settlementType: "escrow_refund",
          status: "confirmed",
          latencyMs: Date.now() - startedAt,
        });
      }
    }
  }

  // Finalize: completing -> approved.
  await convex.mutation(api.requests.markApproved, {
        platformSecret: PLATFORM_SECRET,
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
