import { NextRequest } from "next/server";
import { getConvexClient, requirePlatformSecret } from "@/lib/convex";
import { authenticateRequest } from "@/lib/auth";
import { jsonError } from "@/lib/api-http";
import { buildPaymentRequiredResponse } from "@/lib/x402";
import { getPaymentSignature, settleSignedPayment } from "@/lib/x402-settle";
import { recordSettlementReceipt } from "@/lib/settlement";
import { deliverOffer, readOfferInput } from "@/lib/deliver-offer";
import { logError, lookupErrorResponse } from "@/lib/errors";
import { api } from "@convex/_generated/api";
import { Id } from "@convex/_generated/dataModel";

// POST /api/v1/offers/:id/buy — the `buy` verb.
// x402-gated. Settles payment, emits receipt, proxies to seller's endpoint
// (api type) or returns fileUrl (download type).
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ offerId: string }> },
) {
  const startedAt = Date.now();

  const { secret: platformSecret, error: secretError } = requirePlatformSecret();
  if (secretError) return secretError;

  const { agent, error } = await authenticateRequest(request);
  if (error) return error;

  const { offerId } = await params;
  const convex = getConvexClient();

  let offer;
  try {
    // Internal getter: the buy path needs endpoint/fileUrl/internalHandler,
    // which the public getById projects out.
    offer = await convex.query(api.offers.getByIdInternal, {
      offerId: offerId as Id<"offers">,
      platformSecret,
    });
  } catch (err) {
    return lookupErrorResponse("offers.buy:get-offer", err, "Invalid offer ID", {
      offerId,
    });
  }
  if (!offer || !offer.isActive) {
    return jsonError("Offer not found or inactive", 404);
  }
  // Proxied (external) offers are relayed, not settled here — buy them via the
  // wallet-native /x402/:id route (no API key needed).
  if (offer.externalUrl || !offer.sellerId) {
    return jsonError(
      "Buy this offer at /x402/" + offer._id + " (wallet payment)",
      409,
    );
  }
  const sellerId = offer.sellerId;
  if (sellerId === agent._id) {
    return jsonError("Cannot buy your own offer", 400);
  }

  // Direct buys settle trustlessly buyer -> seller: payTo is the seller's
  // wallet, the platform never takes custody.
  const seller = await convex.query(api.agents.getById, {
    agentId: sellerId,
  });
  if (!seller?.walletAddress) {
    return jsonError("Seller has no wallet address configured", 503);
  }

  const paymentSignature = getPaymentSignature(request);
  if (!paymentSignature) {
    return buildPaymentRequiredResponse(
      offer.priceCents,
      request.url,
      `Payment for offer: ${offer.title}`,
      seller.walletAddress,
    );
  }

  const body = await readOfferInput(request, offer.inputSchema, "offers.buy");
  if (body.error) return body.error;

  const settlement = await settleSignedPayment({
    request,
    paymentSignature,
    amountCents: offer.priceCents,
    payTo: seller.walletAddress,
  });
  if (!settlement.ok) return settlement.response;

  // Emit receipt. The money has moved, so a bookkeeping failure from here on is
  // logged and tolerated — throwing would hand the buyer a 500 and withhold the
  // content they paid for. The log line carries the tx hash so an unrecorded
  // settlement can be reconciled from the chain.
  let receiptId: Id<"receipts"> | null = null;
  try {
    receiptId = await recordSettlementReceipt(convex, {
      platformSecret,
      buyerId: agent._id,
      sellerId,
      offerId: offer._id,
      amountCents: offer.priceCents,
      amountMicroUsd: offer.priceCents * 10000,
      txHash: settlement.txHash,
      settlementType: "direct",
      latencyMs: Date.now() - startedAt,
    });
  } catch (err) {
    logError("offers.buy:record-settlement", err, {
      offerId,
      buyerId: agent._id,
      txHash: settlement.txHash || "",
      amountCents: offer.priceCents,
    });
  }

  return deliverOffer({
    convex,
    platformSecret,
    offer,
    input: body.input,
    rawBody: body.rawBody,
    receiptId,
    txHash: settlement.txHash,
    logScope: "offers.buy",
  });
}
