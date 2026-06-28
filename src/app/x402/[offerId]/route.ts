import { NextRequest, NextResponse } from "next/server";
import { getConvexClient } from "@/lib/convex";
import {
  buildPaymentRequiredResponse,
  verifyPayment,
  verifyPaymentIntegrity,
  settlePayment,
  extractBuyerWallet,
  getFacilitatorUrl,
  getNetwork,
  getNetworkId,
} from "@/lib/x402";
import { runInternalHandler } from "@/lib/internal-offers";
import { assertPublicHttpUrl } from "@/lib/ssrf";
import { attachFeeAdvert, collectFee } from "@/lib/x402-fee";
import { relayExternalBuy } from "@/lib/relay-buy";
import { validateInput } from "@/lib/validate-input";
import { checkRateLimit, getClientIp, RATE_LIMITS } from "@/lib/rate-limit";
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

  // Fail fast on misconfiguration — never after money has moved.
  const platformSecret = process.env.PLATFORM_INTERNAL_KEY || "";
  if (!platformSecret) {
    return NextResponse.json(
      { error: "Platform misconfigured: missing PLATFORM_INTERNAL_KEY" },
      { status: 500 },
    );
  }

  const ip = getClientIp(request);
  const convex = getConvexClient();

  let offer;
  try {
    offer = await convex.query(api.offers.getByIdInternal, {
      offerId: offerId as Id<"offers">,
      platformSecret,
    });
  } catch {
    return NextResponse.json({ error: "Invalid offer ID" }, { status: 400 });
  }
  if (!offer || !offer.isActive) {
    return NextResponse.json(
      { error: "Offer not found or inactive" },
      { status: 404 },
    );
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
    return NextResponse.json(
      { error: "Offer has no seller configured" },
      { status: 503 },
    );
  }
  const seller = await convex.query(api.agents.getById, {
    agentId: offer.sellerId,
  });
  if (!seller?.walletAddress) {
    return NextResponse.json(
      { error: "Seller has no wallet address configured" },
      { status: 503 },
    );
  }

  const canonicalUrl = `${APP_URL}/x402/${offer._id}`;
  const paymentSignature =
    request.headers.get("payment-signature") || request.headers.get("x-payment");

  // No payment -> anonymous 402 challenge (the discovery/probe path).
  if (!paymentSignature) {
    const rl = await checkRateLimit(`x402probe:${ip}`, RATE_LIMITS.unauthenticated);
    if (!rl.allowed) {
      return NextResponse.json({ error: "Too many requests" }, { status: 429 });
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
    return NextResponse.json(
      { error: "Could not read payer wallet from payment" },
      { status: 402 },
    );
  }

  // Rate-limit by wallet; the payment is the economic gate.
  const rl = await checkRateLimit(`x402buy:${buyerWallet.toLowerCase()}`, RATE_LIMITS.invoke);
  if (!rl.allowed) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  if (buyerWallet.toLowerCase() === seller.walletAddress.toLowerCase()) {
    return NextResponse.json(
      { error: "Cannot buy your own offer" },
      { status: 400 },
    );
  }

  // Read + validate the buyer's input BEFORE settling — bad input must never
  // result in a pay-then-fail. Body is read once here and reused for delivery.
  const rawBody = await request.text().catch(() => "");
  let input: Record<string, unknown> = {};
  if (rawBody) {
    try {
      input = JSON.parse(rawBody);
    } catch {
      return NextResponse.json(
        { error: "Request body must be valid JSON" },
        { status: 400 },
      );
    }
  }
  const inputCheck = validateInput(offer.inputSchema, input);
  if (!inputCheck.valid) {
    return NextResponse.json(
      { error: `Invalid input: ${inputCheck.error}` },
      { status: 400 },
    );
  }

  const integrityCheck = verifyPaymentIntegrity(
    paymentSignature,
    offer.priceCents,
    seller.walletAddress,
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

  // Identify (or auto-create) the buyer's wallet account.
  const buyerId: Id<"agents"> = await convex.mutation(
    api.agents.getOrCreateByWallet,
    { walletAddress: buyerWallet, chain: getNetwork() },
  );

  const receiptId: Id<"receipts"> = await convex.mutation(
    api.receipts.recordSettlement,
    {
      platformSecret,
      buyerId,
      sellerId: offer.sellerId,
      offerId: offer._id,
      amountCents: offer.priceCents,
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

  // Collect the optional, buyer-signed PayanAgent fee leg → platform wallet
  // (non-custodial; no-op when the fee is off or absent). Same mechanism as
  // the ecosystem route.
  await collectFee(request);

  // Float this offer into the "sold" rank tier (proven offers rank top).
  await convex.mutation(api.offers.bumpRankOnSale, {
    platformSecret,
    offerId: offer._id,
  });

  // Record whether the service actually delivered (honest receipts).
  const mark = (delivered: boolean, deliveryStatus?: string) =>
    convex.mutation(api.receipts.markDelivered, {
      platformSecret,
      receiptId,
      delivered,
      deliveryStatus,
    });

  // PayanAgent-operated (internal) offer — run server-side, key never exposed.
  if (offer.internalHandler) {
    try {
      const result = await runInternalHandler(offer.internalHandler, input);
      await mark(true);
      return NextResponse.json(result, {
        headers: {
          "X-Receipt-Id": String(receiptId),
          "X-Tx-Hash": settlement.txHash || "",
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "service call failed";
      await mark(false, message.slice(0, 200));
      return NextResponse.json(
        { error: message, receiptId, message: "Payment settled but the service call failed." },
        { status: 502 },
      );
    }
  }

  // Download-type offer: return fileUrl.
  if (offer.offerType === "download") {
    await mark(true);
    return NextResponse.json({
      receiptId,
      fileUrl: offer.fileUrl,
      txHash: settlement.txHash,
    });
  }

  // Api-type offer: proxy to seller's endpoint.
  if (!offer.endpoint) {
    await mark(false, "no endpoint configured");
    return NextResponse.json(
      { error: "Offer has no endpoint configured", receiptId },
      { status: 500 },
    );
  }

  // SSRF guard — re-validate before fetching (defends DNS rebinding).
  try {
    await assertPublicHttpUrl(offer.endpoint);
  } catch (err) {
    const message = err instanceof Error ? err.message : "blocked endpoint";
    await mark(false, "blocked endpoint");
    return NextResponse.json(
      { error: `Offer endpoint not allowed: ${message}`, receiptId },
      { status: 502 },
    );
  }

  try {
    const proxyResponse = await fetch(offer.endpoint, {
      method: offer.httpMethod || "POST",
      headers: { "Content-Type": "application/json" },
      body: rawBody || undefined,
      redirect: "manual",
    });
    const responseData = await proxyResponse.text();
    await mark(proxyResponse.ok, `HTTP ${proxyResponse.status}`);
    return new NextResponse(responseData, {
      status: proxyResponse.status,
      headers: {
        "Content-Type":
          proxyResponse.headers.get("Content-Type") || "application/json",
        "X-Receipt-Id": String(receiptId),
        "X-Tx-Hash": settlement.txHash || "",
      },
    });
  } catch {
    await mark(false, "endpoint unreachable");
    return NextResponse.json(
      {
        error: "Failed to reach offer endpoint",
        receiptId,
        message: "Payment settled but the offer call failed.",
      },
      { status: 502 },
    );
  }
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
