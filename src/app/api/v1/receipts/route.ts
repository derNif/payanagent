import { NextRequest, NextResponse } from "next/server";
import { getConvexClient } from "@/lib/convex";
import {
  enforceIpRateLimit,
  errorResponse,
  parseLimit,
} from "@/lib/api-http";
import { RATE_LIMITS } from "@/lib/rate-limit";
import { toPublicReceipt } from "@/lib/public-projections";
import { cacheHeaders } from "@/lib/cache";
import { api } from "@convex/_generated/api";

// GET /api/v1/receipts — Public receipts feed (newest first).
export async function GET(request: NextRequest) {
  const limited = await enforceIpRateLimit(
    request,
    "public",
    RATE_LIMITS.unauthenticated,
  );
  if (limited) return limited;

  const limit = parseLimit(request.nextUrl.searchParams.get("limit"));

  try {
    const convex = getConvexClient();
    const receipts = await convex.query(api.receipts.listFeed, { limit });
    return NextResponse.json(
      { receipts: receipts.map(toPublicReceipt) },
      { headers: cacheHeaders(300) },
    );
  } catch (error) {
    return errorResponse(error, "Internal server error", 500);
  }
}
