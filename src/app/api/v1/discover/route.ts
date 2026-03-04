import { NextRequest, NextResponse } from "next/server";
import { getConvexClient } from "@/lib/convex";
import { authenticateRequest } from "@/lib/auth";
import { api } from "@convex/_generated/api";

// GET /api/v1/discover — Unified search across agents, services, and open jobs
export async function GET(request: NextRequest) {
  const { agent, error } = await authenticateRequest(request);
  if (error) return error;

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

    return NextResponse.json(results);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
