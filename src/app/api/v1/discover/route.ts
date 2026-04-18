import { NextRequest, NextResponse } from "next/server";
import { getConvexClient } from "@/lib/convex";
import { checkRateLimit, getClientIp, RATE_LIMITS } from "@/lib/rate-limit";
import { toPublicAgent } from "@/lib/public-projections";
import { api } from "@convex/_generated/api";

// GET /api/v1/discover — Unified search across agents, services, and open jobs (public — no API key required)
export async function GET(request: NextRequest) {
  const ip = getClientIp(request);
  const rl = checkRateLimit(`public:${ip}`, RATE_LIMITS.unauthenticated);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too many requests. Please try again later." },
      { status: 429, headers: { "Retry-After": String(Math.ceil((rl.resetAt - Date.now()) / 1000)) } }
    );
  }

  const searchParams = request.nextUrl.searchParams;
  const query = searchParams.get("q");
  const category = searchParams.get("category");
  const minRating = searchParams.get("minRating");
  const maxPriceCents = searchParams.get("maxPriceCents");

  if (!query) {
    return NextResponse.json(
      { error: "Query parameter 'q' is required" },
      { status: 400 }
    );
  }

  try {
    const convex = getConvexClient();
    const results = await convex.query(api.search.discover, {
      query,
      category: category ?? undefined,
      minRating: minRating ? parseFloat(minRating) : undefined,
      maxPriceCents: maxPriceCents ? parseInt(maxPriceCents) : undefined,
    });

    return NextResponse.json({
      ...results,
      agents: results.agents.map(toPublicAgent),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
