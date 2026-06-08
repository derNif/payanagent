import { NextRequest, NextResponse } from "next/server";
import { getConvexClient } from "@/lib/convex";
import { checkRateLimit, getClientIp, RATE_LIMITS } from "@/lib/rate-limit";
import { toPublicReceipt } from "@/lib/public-projections";
import { api } from "@convex/_generated/api";

// GET /api/v1/receipts — Public receipts feed (newest first).
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

  const limitParam = request.nextUrl.searchParams.get("limit");
  const limit = limitParam ? Math.min(Math.max(parseInt(limitParam, 10), 1), 200) : 50;

  try {
    const convex = getConvexClient();
    const receipts = await convex.query(api.receipts.listFeed, { limit });
    return NextResponse.json({ receipts: receipts.map(toPublicReceipt) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
