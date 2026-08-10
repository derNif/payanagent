import { NextRequest, NextResponse } from "next/server";
import { getConvexClient, requirePlatformSecret } from "@/lib/convex";
import { jsonError } from "@/lib/api-http";
import {
  buildPaymentRequiredResponse,
  extractBuyerWallet,
  getNetwork,
} from "@/lib/x402";
import { getPaymentSignature, settleSignedPayment } from "@/lib/x402-settle";
import { recordSettlementReceipt } from "@/lib/settlement";
import { deliverOffer, readOfferInput } from "@/lib/deliver-offer";
import { attachFeeAdvert, collectFee } from "@/lib/x402-fee";
import { relayExternalBuy } from "@/lib/relay-buy";
import { checkRateLimit, getClientIp, RATE_LIMITS } from "@/lib/rate-limit";
import { logError, lookupErrorResponse, swallow } from "@/lib/errors";
import { api } from "@convex/_generated/api";
import { Id } from "@convex/_generated/dataModel";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://payanagent.com";

// GET|POST /x402/:id — the ONE universal buy route. The id resolves to either a
// PayanAgent-native offer (we settle) or an external ecosystem resource (we
// relay non-custodially). The buyer never sees the difference: unpaid -> 402,
// paid -> content + a signed receipt. Backend mechanic is dispatched here; the
// agent just hits one URL.
async function handle(
  request: NextRequest,
  offerId: string,
): Promise<NextResponse> {
  const startedAt = Date.now();

  const { secret: platformSecret, error: secretError } = requirePlatformSecret();
  if (secretError) return secretError;

  const ip = getClientIp(request);
  const convex = getConvexClient();

  let offer;
  try {
    offer = await convex.query(api.offers.getByIdInternal, {
      offerId: offerId as Id<"offers">,
      platformSecret,
    });
  } catch (err) {
    return lookupErrorResponse("x402.buy:get-offer", err, "Invalid offer ID", {
      offerId,
    });
  }
  if (!offer || !offer.isActive) {
    return jsonError("Offer not found or inactive", 404);
  }

  // One route, two fulfillment mechanics — invisible to the buyer. A proxied
  // offer (has externalUrl) is relayed non-custodially; everything else is a
  // native settle. Same /x402/:id, same 402→pay→content→receipt.
  if (offer.externalUrl && offer.payTo && offer.network && offer.amountRaw) {
    return relayExternalBuy(
      request,
      {
        _id: offer._id,
        externalUrl: offer.externalUrl,
        payTo: offer.payTo,
        amountRaw: offer.amountRaw,
        network: offer.network,
      },
      platformSecret,
    );
  }

  // Native: direct buys settle trustlessly buyer -> seller (payTo = seller wallet).
  if (!offer.sellerId) {
    return jsonError("Offer has no seller configured", 503);
  }
  const seller = await convex.query(api.agents.getById, {
    agentId: offer.sellerId,
  });
  if (!seller?.walletAddress) {
    return jsonError("Seller has no wallet address configured", 503);
  }

  const canonicalUrl = `${APP_URL}/x402/${offer._id}`;
  const paymentSignature = getPaymentSignature(request);

  // No payment -> anonymous 402 challenge (the discovery/probe path).
  if (!paymentSignature) {
    const rl = await checkRateLimit(`x402probe:${ip}`, RATE_LIMITS.unauthenticated);
    if (!rl.allowed) {
      return jsonError("Too many requests", 429);
    }
    const challenge = buildPaymentRequiredResponse(
      offer.priceCents,
      canonicalUrl,
      `Payment for offer: ${offer.title}`,
      seller.walletAddress,
    );
    // Advertise the optional PayanAgent fee leg (no-op when the fee is off) so
    // native offers use the exact same fee mechanism as ecosystem buys.
    attachFeeAdvert(challenge.headers, offer.priceCents * 10000);
    return challenge;
  }

  // Buyer identity comes from the payment itself (no API key).
  const buyerWallet = extractBuyerWallet(paymentSignature);
  if (!buyerWallet) {
    return jsonError("Could not read payer wallet from payment", 402);
  }

  // Rate-limit by wallet; the payment is the economic gate.
  const rl = await checkRateLimit(`x402buy:${buyerWallet.toLowerCase()}`, RATE_LIMITS.invoke);
  if (!rl.allowed) {
    return jsonError("Too many requests", 429);
  }

  if (buyerWallet.toLowerCase() === seller.walletAddress.toLowerCase()) {
    return jsonError("Cannot buy your own offer", 400);
  }

  const body = await readOfferInput(request, offer.inputSchema, "x402.buy");
  if (body.error) return body.error;

  const settlement = await settleSignedPayment({
    request,
    paymentSignature,
    amountCents: offer.priceCents,
    payTo: seller.walletAddress,
  });
  if (!settlement.ok) return settlement.response;

  // The money has moved. Bookkeeping failures from here on are logged and
  // tolerated — throwing would hand the buyer a 500 and withhold the content
  // they just paid for. The log line carries the tx hash so an unrecorded
  // settlement can be reconciled from the chain.
  let receiptId: Id<"receipts"> | null = null;
  try {
    // Identify (or auto-create) the buyer's wallet account.
    const buyerId: Id<"agents"> = await convex.mutation(
      api.agents.getOrCreateByWallet,
      { platformSecret, walletAddress: buyerWallet, chain: getNetwork() },
    );
    receiptId = await recordSettlementReceipt(convex, {
      platformSecret,
      buyerId,
      sellerId: offer.sellerId,
      offerId: offer._id,
      amountCents: offer.priceCents,
      amountMicroUsd: offer.priceCents * 10000,
      txHash: settlement.txHash,
      settlementType: "direct",
      latencyMs: Date.now() - startedAt,
    });
  } catch (err) {
    logError("x402.buy:record-settlement", err, {
      offerId,
      buyerWallet,
      txHash: settlement.txHash || "",
      amountCents: offer.priceCents,
    });
  }

  // Collect the optional, buyer-signed PayanAgent fee leg → platform wallet
  // (non-custodial; no-op when the fee is off or absent). Same mechanism as
  // the ecosystem route.
  await collectFee(request);

  // Float this offer into the "sold" rank tier (proven offers rank top).
  await convex
    .mutation(api.offers.bumpRankOnSale, { platformSecret, offerId: offer._id })
    .catch(swallow("x402.buy:bump-rank", { offerId, receiptId }));

  return deliverOffer({
    convex,
    platformSecret,
    offer,
    input: body.input,
    rawBody: body.rawBody,
    receiptId,
    txHash: settlement.txHash,
    logScope: "x402.buy",
  });
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ offerId: string }> },
) {
  const { offerId } = await params;
  return handle(request, offerId);
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ offerId: string }> },
) {
  const { offerId } = await params;
  return handle(request, offerId);
}
