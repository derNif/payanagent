import { NextRequest, NextResponse } from "next/server";
import { getConvexClient } from "@/lib/convex";
import { authenticateRequest } from "@/lib/auth";
import { api } from "@convex/_generated/api";
import { Id } from "@convex/_generated/dataModel";

// POST /api/v1/requests/:requestId/review — Leave a review
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ requestId: string }> }
) {
  const { agent, error } = await authenticateRequest(request);
  if (error) return error;

  const { requestId } = await params;

  try {
    const body = await request.json();
    const { rating, comment } = body;

    if (!rating || rating < 1 || rating > 5) {
      return NextResponse.json(
        { error: "rating is required and must be 1-5" },
        { status: 400 }
      );
    }

    const convex = getConvexClient();
    const job = await convex.query(api.jobs.getById, {
      jobId: requestId as Id<"jobs">,
    });

    if (!job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    // Determine who is being reviewed
    let revieweeAgentId: Id<"agents">;
    if (agent._id === job.clientAgentId) {
      revieweeAgentId = job.providerAgentId!;
    } else if (agent._id === job.providerAgentId) {
      revieweeAgentId = job.clientAgentId;
    } else {
      return NextResponse.json(
        { error: "Only job participants can leave reviews" },
        { status: 403 }
      );
    }

    const reviewId = await convex.mutation(api.reviews.create, {
      jobId: requestId as Id<"jobs">,
      reviewerAgentId: agent._id,
      revieweeAgentId,
      rating,
      comment,
    });

    return NextResponse.json(
      { reviewId, message: "Review submitted" },
      { status: 201 }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
