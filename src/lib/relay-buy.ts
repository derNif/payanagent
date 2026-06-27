import { NextRequest, NextResponse } from "next/server";
import { getConvexClient } from "@/lib/convex";
import { extractBuyerWallet, getNetwork } from "@/lib/x402";
import { assertPublicHttpUrl } from "@/lib/ssrf";
import { attachFeeAdvert, collectFee } from "@/lib/x402-fee";
import { checkRateLimit, getClientIp, RATE_LIMITS } from "@/lib/rate-limit";
import { api } from "@convex/_generated/api";
import { Id } from "@convex/_generated/dataModel";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://payanagent.com";
const BASE_NETWORKS = new Set(["eip155:8453", "base"]);

// The external resource shape the unified buy route hands us (public projection).
export type RelayResource = {
  _id: Id<"externalResources">;
  resource: string;
  payTo: string;
  amountRaw: string;
  network: string;
};

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

// x402 sellers commonly carry the 402 challenge in a base64-JSON header. Rewrite
// the challenge's resource.url → our endpoint so a client that follows it
// retries THROUGH PayanAgent; the signed terms (payTo/amount/asset/network) are
// left untouched.
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

// Buy an EXTERNAL x402 resource THROUGH PayanAgent — non-custodial transparent
// relay. Called by the unified /x402/:id route when the id resolves to an
// ecosystem resource. We forward the seller's own 402 (buyer pays the seller
// directly, the seller's facilitator settles), relay the content back, and
// record a receipt so the external seller earns reputation. We never touch funds.
export async function relayExternalBuy(
  request: NextRequest,
  resource: RelayResource,
  platformSecret: string,
): Promise<NextResponse> {
  const startedAt = Date.now();
  const convex = getConvexClient();

  // Only Base resources are routable (the buyer signs USDC-on-Base terms).
  if (!BASE_NETWORKS.has(resource.network)) {
    return NextResponse.json(
      {
        error: `Resource is on '${resource.network}', not yet routable through PayanAgent`,
        hint: "Only Base (eip155:8453) resources are buyable for now.",
      },
      { status: 501 },
    );
  }

  try {
    await assertPublicHttpUrl(resource.resource);
  } catch (err) {
    const message = err instanceof Error ? err.message : "blocked";
    return NextResponse.json(
      { error: `Resource endpoint not allowed: ${message}` },
      { status: 502 },
    );
  }

  const canonicalUrl = `${APP_URL}/x402/${resource._id}`;
  const paymentHeader =
    request.headers.get("x-payment") ||
    request.headers.get("payment-signature") ||
    request.headers.get("payment");

  const ip = getClientIp(request);
  if (!paymentHeader) {
    const rl = await checkRateLimit(`extprobe:${ip}`, RATE_LIMITS.unauthenticated);
    if (!rl.allowed) {
      return NextResponse.json({ error: "Too many requests" }, { status: 429 });
    }
  }

  const rawBody = request.method === "GET" ? undefined : await request.text().catch(() => "");

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
    for (const name of CHALLENGE_HEADERS) {
      const v = headers.get(name);
      if (v) headers.set(name, rewriteChallengeB64(v, canonicalUrl));
    }
    attachFeeAdvert(headers, Number(resource.amountRaw) || 0);
    return new NextResponse(body, { status: 402, headers });
  }

  // Paid: forward settled buyer→seller, relay content, record a receipt on 2xx.
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
        externalResourceId: resource._id,
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
      await collectFee(request);
    } catch {
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
