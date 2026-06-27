import { NextRequest, NextResponse } from "next/server";
import { getConvexClient } from "@/lib/convex";
import { extractBuyerWallet, getNetwork } from "@/lib/x402";
import { assertPublicHttpUrl } from "@/lib/ssrf";
import { attachFeeAdvert, collectFee } from "@/lib/x402-fee";
import { checkRateLimit, getClientIp, RATE_LIMITS } from "@/lib/rate-limit";
import { api } from "@convex/_generated/api";
import { Id } from "@convex/_generated/dataModel";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://payanagent.com";

// Fee on routed buys. OFF by default — v1 is a pure non-custodial relay. When
// set > 0 (basis points), the two-payment checkout adds a PayanAgent fee leg
// (see the two FEE hooks below). Enabling also needs the buyer-side convention,
// so this stays 0 until we're the default route (Phase 3).
const FEE_BPS = Number(process.env.PAYANAGENT_FEE_BPS || "0");

const BASE_NETWORKS = new Set(["eip155:8453", "base"]);

// Headers we must not forward verbatim (hop-by-hop / length/encoding managed by
// the runtime). Everything else — including the buyer's payment header — passes
// through transparently in both directions.
const STRIP_REQ = new Set([
  "host",
  "connection",
  "content-length",
  "accept-encoding",
  "transfer-encoding",
]);
const STRIP_RES = new Set([
  "content-encoding",
  "content-length",
  "transfer-encoding",
  "connection",
]);

function passthroughResponseHeaders(from: Headers, extra: Record<string, string>): Headers {
  const h = new Headers();
  from.forEach((value, key) => {
    if (!STRIP_RES.has(key.toLowerCase())) h.set(key, value);
  });
  for (const [k, v] of Object.entries(extra)) h.set(k, v);
  return h;
}

// x402 sellers commonly carry the 402 challenge in a base64-JSON header (the
// body may be empty). Rewrite the challenge's resource.url → our endpoint so a
// client that follows it retries THROUGH PayanAgent; the signed terms
// (accepts[].payTo/amount/asset/network) are left untouched.
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

// Parse a settlement tx hash from the seller's X-PAYMENT-RESPONSE header
// (base64 JSON { transaction }) if present. Best-effort — receipt records "" if
// the seller doesn't surface it.
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

// GET|POST /x402/ext/:id — buy an EXTERNAL x402 resource THROUGH PayanAgent.
// Non-custodial transparent relay: we forward the seller's own 402 (buyer pays
// the seller directly, the seller's facilitator settles), relay the content
// back, and record a receipt so the external seller earns reputation and the
// pass-through volume is measured. We never touch the funds.
async function handle(request: NextRequest, id: string): Promise<NextResponse> {
  const startedAt = Date.now();

  const platformSecret = process.env.PLATFORM_INTERNAL_KEY || "";
  if (!platformSecret) {
    return NextResponse.json(
      { error: "Platform misconfigured: missing PLATFORM_INTERNAL_KEY" },
      { status: 500 },
    );
  }

  const convex = getConvexClient();

  let resource;
  try {
    resource = await convex.query(api.aggregator.getExternalById, {
      id: id as Id<"externalResources">,
    });
  } catch {
    return NextResponse.json({ error: "Invalid resource ID" }, { status: 400 });
  }
  if (!resource) {
    return NextResponse.json({ error: "Resource not found" }, { status: 404 });
  }

  // v1: only Base resources are routable (the buyer signs USDC-on-Base terms).
  if (!BASE_NETWORKS.has(resource.network)) {
    return NextResponse.json(
      {
        error: `Resource is on '${resource.network}', not yet routable through PayanAgent`,
        hint: "Only Base (eip155:8453) resources are buyable via /x402/ext for now.",
      },
      { status: 501 },
    );
  }

  // SSRF guard the seller URL before every fetch (defends DNS rebinding).
  try {
    await assertPublicHttpUrl(resource.resource);
  } catch (err) {
    const message = err instanceof Error ? err.message : "blocked";
    return NextResponse.json(
      { error: `Resource endpoint not allowed: ${message}` },
      { status: 502 },
    );
  }

  const canonicalUrl = `${APP_URL}/x402/ext/${id}`;
  const paymentHeader =
    request.headers.get("x-payment") ||
    request.headers.get("payment-signature") ||
    request.headers.get("payment");

  // Rate limit: probes by IP, paid calls by buyer wallet (the economic gate).
  const ip = getClientIp(request);
  if (!paymentHeader) {
    const rl = await checkRateLimit(`extprobe:${ip}`, RATE_LIMITS.unauthenticated);
    if (!rl.allowed) {
      return NextResponse.json({ error: "Too many requests" }, { status: 429 });
    }
  }

  // Read the buyer's body once and forward it verbatim.
  const rawBody = request.method === "GET" ? undefined : await request.text().catch(() => "");

  // Build the forwarded request: copy the buyer's headers (incl. the payment
  // header) minus hop-by-hop. This keeps the relay format-agnostic.
  const fwdHeaders = new Headers();
  request.headers.forEach((value, key) => {
    if (!STRIP_REQ.has(key.toLowerCase())) fwdHeaders.set(key, value);
  });

  let sellerRes: Response;
  try {
    sellerRes = await fetch(resource.resource, {
      method: request.method,
      headers: fwdHeaders,
      body: rawBody && rawBody.length ? rawBody : undefined,
      redirect: "manual",
    });
  } catch {
    return NextResponse.json(
      { error: "Failed to reach the resource", resource: resource.resource },
      { status: 502 },
    );
  }

  // --- Unpaid: relay the seller's 402 challenge (rewrite resource.url → us so
  // the buyer's client retries through PayanAgent, keeping us the route). The
  // signed terms (payTo/amount/asset/network) are passed through untouched. ---
  if (!paymentHeader || sellerRes.status === 402) {
    const text = await sellerRes.text();
    let body = text;
    try {
      const json = JSON.parse(text);
      if (json && typeof json === "object" && json.resource?.url) {
        json.resource.url = canonicalUrl;
      }
      // FEE hook (1/2): when FEE_BPS > 0, append a PayanAgent fee entry to
      // json.accepts here (payTo = platform wallet, amount = feeBps of price).
      body = JSON.stringify(json);
    } catch {
      // Non-JSON challenge — relay verbatim.
    }
    const headers = passthroughResponseHeaders(sellerRes.headers, {
      "Content-Type": sellerRes.headers.get("content-type") || "application/json",
    });
    // Rewrite the resource.url inside any base64 challenge header → us.
    for (const name of CHALLENGE_HEADERS) {
      const v = headers.get(name);
      if (v) headers.set(name, rewriteChallengeB64(v, canonicalUrl));
    }
    // Advertise the optional PayanAgent fee leg (no-op when the fee is off).
    attachFeeAdvert(headers, Number(resource.amountRaw) || 0);
    return new NextResponse(body, { status: 402, headers });
  }

  // --- Paid: the buyer's payment was forwarded; the seller verified+settled
  // buyer→seller and returned content. Relay it back, and record a receipt on
  // a clean delivery (2xx). ---
  const buyerWallet = extractBuyerWallet(paymentHeader);
  const responseBody = await sellerRes.text();

  let receiptId: Id<"receipts"> | null = null;
  if (sellerRes.ok && buyerWallet && buyerWallet.toLowerCase() !== resource.payTo.toLowerCase()) {
    try {
      const [buyerId, sellerId] = await Promise.all([
        convex.mutation(api.agents.getOrCreateByWallet, {
          walletAddress: buyerWallet,
          chain: getNetwork(),
        }),
        convex.mutation(api.agents.getOrCreateByWallet, {
          walletAddress: resource.payTo,
          chain: getNetwork(),
        }),
      ]);
      const amountMicroUsd = Number(resource.amountRaw) || 0;
      receiptId = await convex.mutation(api.receipts.recordSettlement, {
        platformSecret,
        buyerId,
        sellerId,
        externalResourceId: id as Id<"externalResources">,
        amountCents: Math.round(amountMicroUsd / 10000),
        amountMicroUsd,
        currency: "USDC",
        chain: "base",
        network: resource.network,
        txHash: txHashFromResponse(sellerRes),
        settlementType: "external",
        status: "confirmed",
        latencyMs: Date.now() - startedAt,
      });
      await convex.mutation(api.receipts.markDelivered, {
        platformSecret,
        receiptId,
        delivered: true,
      });
      // Collect the optional, buyer-signed fee leg → platform wallet
      // (non-custodial; no-op when the fee is off or absent).
      await collectFee(request);
    } catch {
      // Delivery succeeded for the buyer; only our bookkeeping failed. Don't
      // fail the buyer's response over a receipt write.
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

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return handle(request, id);
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return handle(request, id);
}
