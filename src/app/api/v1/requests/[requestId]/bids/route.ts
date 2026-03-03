import { NextRequest, NextResponse } from "next/server";
import { getConvexClient } from "@/lib/convex";
import { authenticateRequest, unauthorizedResponse } from "@/lib/auth";
import { api } from "@convex/_generated/api";
import { Id } from "@convex/_generated/dataModel";

// GET /api/v1/requests/:requestId/bids — List bids on a job
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ requestId: string }> }
) {
  const agent = await authenticateRequest(request);
  if (!agent) return unauthorizedResponse();

  const { requestId } = await params;
  const convex = getConvexClient();

  try {
    const bids = await convex.query(api.bids.listByJob, {
      jobId: requestId as Id<"jobs">,
    });
    return NextResponse.json({ bids });
  } catch {
    return NextResponse.json({ error: "Invalid job ID" }, { status: 400 });
  }
}

// POST /api/v1/requests/:requestId/bids — Submit a bid
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ requestId: string }> }
) {
  const agent = await authenticateRequest(request);
  if (!agent) return unauthorizedResponse();

  const { requestId } = await params;

  try {
    const body = await request.json();
    const { priceCents, estimatedDurationSeconds, message } = body;

    if (!priceCents) {
      return NextResponse.json(
        { error: "priceCents is required" },
        { status: 400 }
      );
    }

    const convex = getConvexClient();
    const bidId = await convex.mutation(api.bids.create, {
      jobId: requestId as Id<"jobs">,
      agentId: agent._id,
      priceCents,
      estimatedDurationSeconds,
      message,
    });

    return NextResponse.json(
      { bidId, priceCents, message: "Bid submitted" },
      { status: 201 }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
