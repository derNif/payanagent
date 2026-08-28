import { NextRequest, NextResponse } from "next/server";
import { getConvexClient } from "@/lib/convex";
import { extractBuyerWallet, getNetwork } from "@/lib/x402";
import { assertPublicHttpUrl } from "@/lib/ssrf";
import { attachFeeAdvert, collectFee } from "@/lib/x402-fee";
import { errorMessage, logError } from "@/lib/errors";
import { api } from "@convex/_generated/api";
import { Id } from "@convex/_generated/dataModel";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://payanagent.com";
const BASE_NETWORKS = new Set(["eip155:8453", "base"]);

// The fields the relay needs from a proxied (external) offer. The full offer doc
// satisfies this — `externalUrl` is the relay target, `payTo`/`amountRaw`/
// `network` are the seller's on-chain terms.
export type RelayOffer = {
  _id: Id<"offers">;
  externalUrl: string;
  payTo: string;
  amountRaw: string;
  network: string;
};

// The relay target is a THIRD-PARTY, seller-controlled URL, so request headers
// are forwarded by allowlist only: the x402 payment carriers plus the content
// negotiation headers a seller legitimately needs. A denylist leaked whatever
// the buyer happened to send — including `authorization` (their PayanAgent API
// key) and `cookie` — to any address a seller registered.
const FORWARD_REQ = new Set([
  "accept",
  "accept-language",
  "content-type",
  "payment",
  "payment-required",
  "payment-signature",
  "x-payment",
  "x-payment-required",
]);
const STRIP_RES = new Set([
  "content-encoding",
  "content-length",
  "transfer-encoding",
  "connection",
  // A seller must not be able to set cookies or auth challenges on our origin.
  "set-cookie",
  "set-cookie2",
  "www-authenticate",
  "proxy-authenticate",
  "strict-transport-security",
  "content-security-policy",
  "content-security-policy-report-only",
]);

function forwardRequestHeaders(from: Headers): Headers {
  const h = new Headers();
  from.forEach((value, key) => {
    if (FORWARD_REQ.has(key.toLowerCase())) h.set(key, value);
  });
  return h;
}

function passthroughResponseHeaders(from: Headers, extra: Record<string, string>): Headers {
  const h = new Headers();
  from.forEach((value, key) => {
    if (!STRIP_RES.has(key.toLowerCase())) h.set(key, value);
  });
  for (const [k, v] of Object.entries(extra)) h.set(k, v);
  return h;
}

// x402 sellers commonly carry the 402 challenge in a base64-JSON header. Rewrite
// the challenge's resource.url → our endpoint so a client that follows it retries
// THROUGH PayanAgent; the signed terms (payTo/amount/asset/network) are untouched.
const CHALLENGE_HEADERS = ["payment-required", "x-payment-required", "www-authenticate"];
function rewriteChallengeB64(value: string, newUrl: string): string {
  try {
    const json = JSON.parse(Buffer.from(value, "base64").toString("utf8"));
    if (json && typeof json === "object" && json.resource?.url) {
      json.resource.url = newUrl;
      return Buffer.from(JSON.stringify(json)).toString("base64");
    }
  } catch {
    // not base64 JSON — leave as-is
  }
  return value;
}

// Unpaid probes vastly outnumber real buys and most of the catalog's sellers
// are slow or gone, so a probe gets a short leash while a paid buy gets a
// generous one (the seller may be doing real paid work).
const PROBE_TIMEOUT_MS = 8_000;
const PAID_TIMEOUT_MS = 60_000;

// Per-instance cache of relayed 402 challenges. A challenge only changes when
// the seller re-prices, so repeated probes of the same offer (crawler sweeps)
// must not each cost an SSRF DNS lookup + an upstream fetch to the seller.
const CHALLENGE_TTL_MS = 120_000;
const CHALLENGE_CACHE_MAX = 5_000;
const challengeCache = new Map<
  string,
  { body: string; headers: [string, string][]; expiresAt: number }
>();

function cachedChallenge(key: string): NextResponse | null {
  const hit = challengeCache.get(key);
  if (!hit) return null;
  if (Date.now() > hit.expiresAt) {
    challengeCache.delete(key);
    return null;
  }
  return new NextResponse(hit.body, {
    status: 402,
    headers: new Headers(hit.headers),
  });
}

function storeChallenge(key: string, body: string, headers: Headers): void {
  if (challengeCache.size >= CHALLENGE_CACHE_MAX) {
    const oldest = challengeCache.keys().next().value;
    if (oldest !== undefined) challengeCache.delete(oldest);
  }
  challengeCache.set(key, {
    body,
    headers: [...headers.entries()],
    expiresAt: Date.now() + CHALLENGE_TTL_MS,
  });
}

function txHashFromResponse(res: Response): string {
  const raw = res.headers.get("x-payment-response") || res.headers.get("payment-response");
  if (!raw) return "";
  try {
    const json = JSON.parse(Buffer.from(raw, "base64").toString("utf8"));
    return typeof json?.transaction === "string" ? json.transaction : "";
  } catch {
    return "";
  }
}

// Fulfill a PROXIED offer by relaying its external x402 resource — non-custodial.
// Called by the unified /x402/:id route when the offer has an `externalUrl`. We
// forward the seller's own 402 (buyer pays the seller directly, the seller's
// facilitator settles), relay the content back, record a receipt against the
// offer, and backfill the offer's seller agent on its first sale so it ranks in
// the leaderboard like any other. We never touch funds.
export async function relayExternalBuy(
  request: NextRequest,
  offer: RelayOffer,
  platformSecret: string,
): Promise<NextResponse> {
  const startedAt = Date.now();
  const convex = getConvexClient();

  if (!BASE_NETWORKS.has(offer.network)) {
    return NextResponse.json(
      {
        error: `This offer settles on '${offer.network}', not yet routable through PayanAgent`,
        hint: "Only Base (eip155:8453) offers are buyable for now.",
      },
      { status: 501 },
    );
  }

  const canonicalUrl = `${APP_URL}/x402/${offer._id}`;
  const paymentHeader =
    request.headers.get("x-payment") ||
    request.headers.get("payment-signature") ||
    request.headers.get("payment");

  // Unpaid probe with a warm challenge: answer from cache without touching
  // DNS or the seller at all. (Probe rate limiting happens in the route,
  // before the Convex offer lookup.)
  const challengeKey = `${offer._id}:${request.method}`;
  if (!paymentHeader) {
    const cached = cachedChallenge(challengeKey);
    if (cached) return cached;
  }

  try {
    await assertPublicHttpUrl(offer.externalUrl);
  } catch (err) {
    const message = errorMessage(err, "blocked");
    logError("relay-buy:ssrf-guard", err, { offerId: offer._id });
    return NextResponse.json(
      { error: `Offer endpoint not allowed: ${message}` },
      { status: 502 },
    );
  }

  // A body we cannot read must not be relayed as an empty one — the buyer would
  // pay the seller for a call that carried none of their input.
  let rawBody: string | undefined;
  if (request.method !== "GET") {
    try {
      rawBody = await request.text();
    } catch (err) {
      logError("relay-buy:read-body", err, { offerId: offer._id });
      return NextResponse.json(
        { error: "Could not read request body" },
        { status: 400 },
      );
    }
  }

  const fwdHeaders = forwardRequestHeaders(request.headers);

  let sellerRes: Response;
  try {
    sellerRes = await fetch(offer.externalUrl, {
      method: request.method,
      headers: fwdHeaders,
      body: rawBody && rawBody.length ? rawBody : undefined,
      redirect: "manual",
      signal: AbortSignal.timeout(
        paymentHeader ? PAID_TIMEOUT_MS : PROBE_TIMEOUT_MS,
      ),
    });
  } catch (err) {
    logError("relay-buy:fetch-seller", err, { offerId: offer._id });
    return NextResponse.json(
      { error: "Failed to reach the offer endpoint" },
      { status: 502 },
    );
  }

  // Unpaid: relay the seller's 402 (rewrite resource.url → us, terms untouched).
  if (!paymentHeader || sellerRes.status === 402) {
    const text = await sellerRes.text();
    let body = text;
    try {
      const json = JSON.parse(text);
      if (json && typeof json === "object" && json.resource?.url) {
        json.resource.url = canonicalUrl;
      }
      body = JSON.stringify(json);
    } catch {
      // Non-JSON challenge — relay verbatim.
    }
    const headers = passthroughResponseHeaders(sellerRes.headers, {
      "Content-Type": sellerRes.headers.get("content-type") || "application/json",
    });
    // Read challenge carriers from the SELLER's headers: STRIP_RES removes
    // `www-authenticate` from the passthrough set (a seller must not challenge
    // auth on our origin), but on a 402 that header IS the payment challenge.
    for (const name of CHALLENGE_HEADERS) {
      const v = sellerRes.headers.get(name);
      if (v) headers.set(name, rewriteChallengeB64(v, canonicalUrl));
    }
    attachFeeAdvert(headers, Number(offer.amountRaw) || 0);
    if (!paymentHeader && sellerRes.status === 402) {
      storeChallenge(challengeKey, body, headers);
    }
    return new NextResponse(body, { status: 402, headers });
  }

  // Paid: forward settled buyer→seller, relay content, record a receipt on 2xx.
  const buyerWallet = extractBuyerWallet(paymentHeader);
  const responseBody = await sellerRes.text();

  let receiptId: Id<"receipts"> | null = null;
  if (sellerRes.ok && buyerWallet && buyerWallet.toLowerCase() !== offer.payTo.toLowerCase()) {
    try {
      const [buyerId, sellerId] = await Promise.all([
        convex.mutation(api.agents.getOrCreateByWallet, {
          platformSecret,
          walletAddress: buyerWallet,
          chain: getNetwork(),
        }),
        convex.mutation(api.agents.getOrCreateByWallet, {
          platformSecret,
          walletAddress: offer.payTo,
          chain: getNetwork(),
        }),
      ]);
      const amountMicroUsd = Number(offer.amountRaw) || 0;
      receiptId = await convex.mutation(api.receipts.recordSettlement, {
        platformSecret,
        buyerId,
        sellerId,
        offerId: offer._id,
        amountCents: Math.round(amountMicroUsd / 10000),
        amountMicroUsd,
        currency: "USDC",
        chain: "base",
        network: offer.network,
        txHash: txHashFromResponse(sellerRes),
        settlementType: "external",
        status: "confirmed",
        latencyMs: Date.now() - startedAt,
      });
      // Follow-ups are best-effort: a failure here must not wipe the receipt
      // id of a settlement that was recorded (buyer still gets X-Receipt-Id).
      try {
        await convex.mutation(api.receipts.markDelivered, {
          platformSecret,
          receiptId,
          delivered: true,
        });
        // First sale → make this proxied seller first-class (ranks in the
        // leaderboard) and float the offer into the "sold" rank tier.
        await convex.mutation(api.offers.backfillSeller, {
          platformSecret,
          offerId: offer._id,
          sellerId,
        });
        await convex.mutation(api.offers.bumpRankOnSale, {
          platformSecret,
          offerId: offer._id,
        });
        await collectFee(request);
      } catch (err) {
        // receipt exists; ranking/delivery marks catch up on the next sale
        logError("relay-buy:post-settlement", err, {
          offerId: offer._id,
          receiptId,
        });
      }
    } catch (err) {
      // A settlement happened on-chain and we could not record it. Nothing to
      // return to the buyer but the seller's content, so log loudly with the
      // tx hash — this is the only trace left to reconcile from.
      logError("relay-buy:record-settlement", err, {
        offerId: offer._id,
        buyerWallet,
        payTo: offer.payTo,
        txHash: txHashFromResponse(sellerRes),
      });
      receiptId = null;
    }
  }

  return new NextResponse(responseBody, {
    status: sellerRes.status,
    headers: passthroughResponseHeaders(sellerRes.headers, {
      "Content-Type": sellerRes.headers.get("content-type") || "application/json",
      ...(receiptId ? { "X-Receipt-Id": String(receiptId) } : {}),
      "X-Routed-Through": "payanagent",
    }),
  });
}
