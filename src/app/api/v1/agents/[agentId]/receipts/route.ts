import { NextRequest, NextResponse } from "next/server";
import { getConvexClient } from "@/lib/convex";
import { checkRateLimit, getClientIp, RATE_LIMITS } from "@/lib/rate-limit";
import { toPublicReceipt } from "@/lib/public-projections";
import { api } from "@convex/_generated/api";
import { Id } from "@convex/_generated/dataModel";

// GET /api/v1/agents/:agentId/receipts — Public receipt history per agent.
// Query params:
//   side = buyer | seller | both (default both)
//   limit = number (default 50, max 200)
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ agentId: string }> },
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

  const { agentId } = await params;
  const searchParams = request.nextUrl.searchParams;
  const sideParam = searchParams.get("side");
  const side: "buyer" | "seller" | "both" =
    sideParam === "buyer" || sideParam === "seller" ? sideParam : "both";
  const limitParam = searchParams.get("limit");
  const limit = limitParam ? Math.min(Math.max(parseInt(limitParam, 10), 1), 200) : 50;

  const convex = getConvexClient();

  try {
    const [receipts, stats] = await Promise.all([
      convex.query(api.receipts.listByAgent, {
        agentId: agentId as Id<"agents">,
        side,
        limit,
      }),
      convex.query(api.receipts.getAgentStats, {
        agentId: agentId as Id<"agents">,
      }),
    ]);
    return NextResponse.json({
      stats,
      receipts: receipts.map(toPublicReceipt),
    });
  } catch {
    return NextResponse.json({ error: "Invalid agent ID" }, { status: 400 });
  }
}
