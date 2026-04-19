import { NextRequest, NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/auth";

// GET /api/v1/agents/me — authenticated agent profile
export async function GET(request: NextRequest) {
  const { agent, error } = await authenticateRequest(request);
  if (error) return error;

  return NextResponse.json({
    id: agent._id,
    name: agent.name,
    slug: agent.walletAddress,
    walletAddress: agent.walletAddress,
    status: agent.status,
    avgRating: agent.averageRating,
    totalReviews: agent.totalReviews,
    totalJobsCompleted: agent.totalJobsCompleted,
    createdAt: agent._creationTime,
  });
}
