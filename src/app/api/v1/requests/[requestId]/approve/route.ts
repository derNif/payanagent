import { NextRequest, NextResponse } from "next/server";
import { getConvexClient } from "@/lib/convex";
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
  if (req.status !== "fulfilled") {
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
      return buildPaymentRequiredResponse(
        req.agreedPriceCents,
        request.url,
        `Payment for request: ${req.title}`,
        provider.walletAddress,
      );
    }

    const integrityCheck = verifyPaymentIntegrity(
      paymentSignature,
      req.agreedPriceCents,
      provider.walletAddress,
    );
    if (!integrityCheck.valid) {
      return NextResponse.json(
        { error: `Payment integrity check failed: ${integrityCheck.error}` },
        { status: 402 },
      );
    }

    const paymentRequired = request.headers.get("payment-required") || "";
    const verification = await verifyPayment(paymentSignature, paymentRequired);
    if (!verification.valid) {
      return NextResponse.json(
        { error: `Payment verification failed: ${verification.error}` },
        { status: 402 },
      );
    }

    const settlement = await settlePayment(paymentSignature, paymentRequired);
    if (!settlement.success) {
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
      requestId: req._id,
      allowedFrom: ["fulfilled"],
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
    await convex.mutation(api.requests.revertSettlement, { requestId: req._id });
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
    requestId: req._id,
    settlementReceiptId: receiptId,
  });

  return NextResponse.json({
    ok: true,
    receiptId,
    txHash: release.txHash,
    surplusRefundedCents: refundTxHash ? surplus : 0,
    refundReceiptId,
    refundTxHash,
  });
}
