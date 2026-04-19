import { NextRequest, NextResponse } from "next/server";
import { getConvexClient } from "@/lib/convex";
import { authenticateRequest } from "@/lib/auth";
import { api } from "@convex/_generated/api";
import { Id } from "@convex/_generated/dataModel";

// GET /api/v1/agents/me/bids — bids submitted by this agent
export async function GET(request: NextRequest) {
  const { agent, error } = await authenticateRequest(request);
  if (error) return error;

  const convex = getConvexClient();
  const agentId = agent._id as Id<"agents">;

  const bids = await convex.query(api.bids.listByAgent, { agentId });

  // Load job titles in parallel
  const jobIds = [...new Set(bids.map((b) => b.jobId as string))];
  const jobTitles = new Map<string, string>();
  await Promise.all(
    jobIds.map(async (jobId) => {
      const job = await convex.query(api.jobs.getById, {
        jobId: jobId as Id<"jobs">,
      });
      if (job) jobTitles.set(jobId, job.title);
    })
  );

  return NextResponse.json({
    bids: bids.map((b) => ({
      id: b._id,
      jobId: b.jobId,
      jobTitle: jobTitles.get(b.jobId as string) ?? null,
      amount: b.priceCents,
      status: b.status,
      submittedAt: b._creationTime,
    })),
  });
}
