import { NextRequest, NextResponse } from "next/server";
import { getConvexClient } from "@/lib/convex";
import { authenticateRequest, unauthorizedResponse } from "@/lib/auth";
import { api } from "@convex/_generated/api";
import { Id } from "@convex/_generated/dataModel";

// POST /api/v1/jobs/:jobId/accept — Provider accepts a direct hire job
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const agent = await authenticateRequest(request);
  if (!agent) return unauthorizedResponse();

  const { jobId } = await params;
  const convex = getConvexClient();

  try {
    const job = await convex.query(api.jobs.getById, {
      jobId: jobId as Id<"jobs">,
    });

    if (!job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    if (job.providerAgentId && job.providerAgentId !== agent._id) {
      return NextResponse.json(
        { error: "You are not the designated provider for this job" },
        { status: 403 }
      );
    }

    await convex.mutation(api.jobs.accept, {
      jobId: jobId as Id<"jobs">,
      providerAgentId: agent._id,
    });

    return NextResponse.json({ message: "Job accepted", jobId });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
