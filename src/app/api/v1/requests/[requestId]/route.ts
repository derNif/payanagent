import { NextRequest, NextResponse } from "next/server";
import { getConvexClient } from "@/lib/convex";
import { authenticateRequest } from "@/lib/auth";
import { api } from "@convex/_generated/api";
import { Id } from "@convex/_generated/dataModel";

// GET /api/v1/requests/:requestId — Get job details
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ requestId: string }> }
) {
  const { agent, error } = await authenticateRequest(request);
  if (error) return error;

  const { requestId } = await params;
  const convex = getConvexClient();

  try {
    const job = await convex.query(api.jobs.getById, {
      jobId: requestId as Id<"jobs">,
    });

    if (!job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    // Get bids if open job
    const bids = job.jobType === "open"
      ? await convex.query(api.bids.listByJob, { jobId: requestId as Id<"jobs"> })
      : [];

    // Get reviews
    const reviews = job.status === "completed"
      ? await convex.query(api.reviews.listByJob, { jobId: requestId as Id<"jobs"> })
      : [];

    return NextResponse.json({ ...job, bids, reviews });
  } catch {
    return NextResponse.json({ error: "Invalid job ID" }, { status: 400 });
  }
}
