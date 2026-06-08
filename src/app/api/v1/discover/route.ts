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
    const results = await convex.query(api.search.discoverV2, {
      query,
      category,
      maxPriceCents,
      offerType,
      limit,
    });

    return NextResponse.json({
      agents: results.agents.map(toPublicAgent),
      offers: results.offers.map(toPublicOffer),
      openRequests: results.openRequests,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
