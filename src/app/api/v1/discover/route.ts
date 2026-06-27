import { NextRequest, NextResponse } from "next/server";
import { getConvexClient } from "@/lib/convex";
import { checkRateLimit, getClientIp, RATE_LIMITS } from "@/lib/rate-limit";
import { toPublicAgent, toPublicOffer } from "@/lib/public-projections";
import { api } from "@convex/_generated/api";

// GET /api/v1/discover — Unified search across agents, offers, and open requests.
// Public, rate-limited.
//
// Query params:
//   q              required free-text
//   category       optional offer category
//   maxPriceCents  optional max offer price
//   offerType      api | download
//   limit          1..200 (default 50)
export async function GET(request: NextRequest) {
  const ip = getClientIp(request);
  const rl = await checkRateLimit(`public:${ip}`, RATE_LIMITS.unauthenticated);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too many requests. Please try again later." },
      {
        status: 429,
        headers: {
          "Retry-After": String(Math.ceil((rl.resetAt - Date.now()) / 1000)),
        },
      },
    );
  }

  const sp = request.nextUrl.searchParams;
  const query = sp.get("q");
  if (!query) {
    return NextResponse.json(
      { error: "Query parameter 'q' is required" },
      { status: 400 },
    );
  }

  const category = sp.get("category") ?? undefined;
  const maxPriceParam = sp.get("maxPriceCents");
  const maxPriceCents = maxPriceParam ? parseInt(maxPriceParam, 10) : undefined;
  const offerTypeParam = sp.get("offerType");
  const offerType =
    offerTypeParam === "api" || offerTypeParam === "download"
      ? offerTypeParam
      : undefined;
  const limitParam = sp.get("limit");
  const limit = limitParam
    ? Math.min(Math.max(parseInt(limitParam, 10), 1), 200)
    : 50;

  try {
    const convex = getConvexClient();
    // Native (with filters) + the whole ecosystem (query match) in one list, so
    // SDK/MCP `discover` returns the entire market. Every entry carries a buyUrl
    // (/x402/:id) — buy any of them the same way, no native/ecosystem split.
    const [results, catalog] = await Promise.all([
      convex.query(api.search.discoverV2, {
        query,
        category,
        maxPriceCents,
        offerType,
        limit,
      }),
      convex.query(api.catalog.search, { query, limit }),
    ]);

    const nativeOffers = results.offers.map((o) => ({
      ...toPublicOffer(o),
      source: "native" as const,
      buyUrl: `/x402/${o._id}`,
    }));
    const ecosystemOffers = catalog
      .filter((e) => e.source === "ecosystem")
      .map((e) => ({
        _id: e.id,
        title: e.title,
        description: e.description,
        category: e.category,
        tags: e.tags,
        priceCents: e.priceCents,
        priceUsd: e.priceUsd,
        offerType: e.offerType,
        inputSchema: e.inputSchema,
        outputSchema: e.outputSchema,
        sellerWallet: e.sellerWallet,
        buyable: e.buyable,
        source: "ecosystem" as const,
        buyUrl: `/x402/${e.id}`,
      }));

    return NextResponse.json({
      agents: results.agents.map(toPublicAgent),
      offers: [...nativeOffers, ...ecosystemOffers],
      openRequests: results.openRequests,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
