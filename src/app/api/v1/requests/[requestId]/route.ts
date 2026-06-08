import { NextRequest, NextResponse } from "next/server";
import { getConvexClient } from "@/lib/convex";
import { checkRateLimit, getClientIp, RATE_LIMITS } from "@/lib/rate-limit";
import { api } from "@convex/_generated/api";
import { Id } from "@convex/_generated/dataModel";

// GET /api/v1/requests/:requestId — Public detail, including bids.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ requestId: string }> },
) {
  const ip = getClientIp(request);
  const rl = await checkRateLimit(`public:${ip}`, RATE_LIMITS.unauthenticated);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too many requests" },
      {
        status: 429,
        headers: {
          "Retry-After": String(Math.ceil((rl.resetAt - Date.now()) / 1000)),
        },
      },
    );
  }

  const { requestId } = await params;
  const convex = getConvexClient();

  try {
    const result = await convex.query(api.requests.getWithBids, {
      requestId: requestId as Id<"requests">,
    });
    if (!result.request) {
      return NextResponse.json({ error: "Request not found" }, { status: 404 });
    }
    return NextResponse.json({
      request: result.request,
      bids: result.bids,
    });
  } catch {
    return NextResponse.json({ error: "Invalid request ID" }, { status: 400 });
  }
}
