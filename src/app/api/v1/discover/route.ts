import { NextRequest, NextResponse } from "next/server";
import { getConvexClient } from "@/lib/convex";
import {
  enforceIpRateLimit,
  errorResponse,
  jsonError,
  parseLimit,
} from "@/lib/api-http";
import { RATE_LIMITS } from "@/lib/rate-limit";
import { toPublicAgent, toPublicOffer } from "@/lib/public-projections";
import { cacheHeaders } from "@/lib/cache";
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
  const limited = await enforceIpRateLimit(
    request,
    "public",
    RATE_LIMITS.unauthenticated,
  );
  if (limited) return limited;

  const sp = request.nextUrl.searchParams;
  const query = sp.get("q");
  if (!query) {
    return jsonError("Query parameter 'q' is required", 400);
  }

  const category = sp.get("category") ?? undefined;
  const maxPriceParam = sp.get("maxPriceCents");
  const maxPriceCents = maxPriceParam ? parseInt(maxPriceParam, 10) : undefined;
  const offerTypeParam = sp.get("offerType");
  const offerType =
    offerTypeParam === "api" || offerTypeParam === "download"
      ? offerTypeParam
      : undefined;
  const limit = parseLimit(sp.get("limit"));

  try {
    const convex = getConvexClient();
    // Searches the whole offers table (native + proxied) in one go — one market,
    // every offer buyable at its buyUrl (/x402/:id).
    const results = await convex.query(api.search.discoverV2, {
      query,
      category,
      maxPriceCents,
      offerType,
      limit,
    });

    return NextResponse.json(
      {
        agents: results.agents.map(toPublicAgent),
        offers: results.offers.map((o) => ({
          ...toPublicOffer(o),
          buyUrl: `/x402/${o._id}`,
        })),
        openRequests: results.openRequests,
      },
      { headers: cacheHeaders(300) },
    );
  } catch (error) {
    return errorResponse(error, "Internal server error", 500);
  }
}
