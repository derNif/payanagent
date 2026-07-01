import { NextRequest, NextResponse } from "next/server";
import { getConvexClient } from "@/lib/convex";
import { authenticateRequest } from "@/lib/auth";
import {
  buildPaymentRequiredResponse,
  verifyPayment,
  verifyPaymentIntegrity,
  settlePayment,
  getFacilitatorUrl,
  getNetwork,
  getNetworkId,
} from "@/lib/x402";
import { runInternalHandler } from "@/lib/internal-offers";
import { assertPublicHttpUrl } from "@/lib/ssrf";
import { validateInput } from "@/lib/validate-input";
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
  } catch {
    return NextResponse.json({ error: "Invalid offer ID" }, { status: 400 });
  }
  if (!offer || !offer.isActive) {
    return NextResponse.json(
      { error: "Offer not found or inactive" },
      { status: 404 },
    );
  }
  // Proxied (external) offers are relayed, not settled here — buy them via the
  // wallet-native /x402/:id route (no API key needed).
  if (offer.externalUrl || !offer.sellerId) {
    return NextResponse.json(
      { error: "Buy this offer at /x402/" + offer._id + " (wallet payment)" },
      { status: 409 },
    );
  }
  const sellerId = offer.sellerId;
  if (sellerId === agent._id) {
    return NextResponse.json(
      { error: "Cannot buy your own offer" },
      { status: 400 },
    );
  }

  // Direct buys settle trustlessly buyer -> seller: payTo is the seller's
  // wallet, the platform never takes custody.
  const seller = await convex.query(api.agents.getById, {
    agentId: sellerId,
  });
  if (!seller?.walletAddress) {
    return NextResponse.json(
      { error: "Seller has no wallet address configured" },
      { status: 503 },
    );
  }

  const paymentSignature =
    request.headers.get("payment-signature") || request.headers.get("x-payment");
  if (!paymentSignature) {
    return buildPaymentRequiredResponse(
      offer.priceCents,
      request.url,
      `Payment for offer: ${offer.title}`,
      seller.walletAddress,
    );
  }

  // Validate the buyer's input BEFORE settling — never pay-then-fail on bad
  // input. Body read once here and reused for delivery.
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

  // Emit receipt
  const receiptId: Id<"receipts"> = await convex.mutation(
    api.receipts.recordSettlement,
    {
      platformSecret,
      buyerId: agent._id,
      sellerId,
      offerId: offer._id,
      amountCents: offer.priceCents,
      amountMicroUsd: offer.priceCents * 10000,
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

  // Record whether the service actually delivered (honest receipts).
  const mark = (delivered: boolean, deliveryStatus?: string) =>
    convex.mutation(api.receipts.markDelivered, {
      platformSecret,
      receiptId,
      delivered,
      deliveryStatus,
    });

  // PayanAgent-operated (internal) offer: run the handler server-side. The
  // backend key lives only on the server and is never exposed as a callable
  // route, so it can't be drained by unpaid callers.
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
        {
          error: message,
          receiptId,
          message: "Payment settled but the service call failed.",
        },
        { status: 502 },
      );
    }
  }

  // Download-type offer: return fileUrl
  if (offer.offerType === "download") {
    await mark(true);
    return NextResponse.json({
      receiptId,
      fileUrl: offer.fileUrl,
      txHash: settlement.txHash,
    });
  }

  // Api-type offer: proxy to seller's endpoint
  if (!offer.endpoint) {
    await mark(false, "no endpoint configured");
    return NextResponse.json(
      { error: "Offer has no endpoint configured", receiptId },
      { status: 500 },
    );
  }

  // SSRF guard: re-validate the endpoint right before fetching so a host that
  // now resolves to a private/metadata address is rejected (defends against
  // DNS rebinding even though we also validate at offer create/update time).
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
    // Never forward internal secrets to seller endpoints — they are
    // arbitrary external servers. Don't follow redirects into internal targets.
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
