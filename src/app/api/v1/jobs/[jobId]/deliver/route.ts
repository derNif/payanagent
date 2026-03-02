import { NextRequest, NextResponse } from "next/server";
import { getConvexClient } from "@/lib/convex";
import { authenticateRequest, unauthorizedResponse } from "@/lib/auth";
import { api } from "@convex/_generated/api";
import { Id } from "@convex/_generated/dataModel";

// POST /api/v1/jobs/:jobId/deliver — Provider submits deliverable
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const agent = await authenticateRequest(request);
  if (!agent) return unauthorizedResponse();

  const { jobId } = await params;

  try {
    const body = await request.json();
    const { outputPayload } = body;

    if (!outputPayload) {
      return NextResponse.json(
        { error: "outputPayload is required" },
        { status: 400 }
      );
    }

    const convex = getConvexClient();
    const job = await convex.query(api.jobs.getById, {
      jobId: jobId as Id<"jobs">,
    });

    if (!job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    if (job.providerAgentId !== agent._id) {
      return NextResponse.json(
        { error: "Only the provider can deliver work" },
        { status: 403 }
      );
    }

    // Auto-transition to in_progress if still in accepted state
    if (job.status === "accepted") {
      await convex.mutation(api.jobs.startWork, {
        jobId: jobId as Id<"jobs">,
      });
    }

    await convex.mutation(api.jobs.deliver, {
      jobId: jobId as Id<"jobs">,
      outputPayload,
    });

    return NextResponse.json({
      message: "Deliverable submitted. Awaiting client approval.",
      jobId,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
