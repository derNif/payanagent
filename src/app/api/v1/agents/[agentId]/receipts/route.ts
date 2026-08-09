import { NextRequest, NextResponse } from "next/server";
import { getConvexClient } from "@/lib/convex";
import { enforceIpRateLimit, jsonError, parseLimit } from "@/lib/api-http";
import { RATE_LIMITS } from "@/lib/rate-limit";
import { toPublicReceipt } from "@/lib/public-projections";
import { cacheHeaders } from "@/lib/cache";
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
  const limited = await enforceIpRateLimit(
    request,
    "public",
    RATE_LIMITS.unauthenticated,
    "Too many requests",
  );
  if (limited) return limited;

  const { agentId } = await params;
  const searchParams = request.nextUrl.searchParams;
  const sideParam = searchParams.get("side");
  const side: "buyer" | "seller" | "both" =
    sideParam === "buyer" || sideParam === "seller" ? sideParam : "both";
  const limit = parseLimit(searchParams.get("limit"));

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
    return NextResponse.json(
      {
        stats,
        receipts: receipts.map(toPublicReceipt),
      },
      { headers: cacheHeaders(300) },
    );
  } catch {
    return jsonError("Invalid agent ID", 400);
  }
}
