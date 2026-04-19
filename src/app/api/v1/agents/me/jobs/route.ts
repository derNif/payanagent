import { NextRequest, NextResponse } from "next/server";
import { getConvexClient } from "@/lib/convex";
import { authenticateRequest } from "@/lib/auth";
import { api } from "@convex/_generated/api";
import { Id } from "@convex/_generated/dataModel";

// GET /api/v1/agents/me/jobs — jobs as requester and as provider
export async function GET(request: NextRequest) {
  const { agent, error } = await authenticateRequest(request);
  if (error) return error;

  const convex = getConvexClient();
  const agentId = agent._id as Id<"agents">;

  const [requesterJobs, providerJobs] = await Promise.all([
    convex.query(api.jobs.listByClient, { clientAgentId: agentId }),
    convex.query(api.jobs.listByProvider, { providerAgentId: agentId }),
  ]);

  // Collect unique counterparty agent IDs for name lookup
  const counterpartyIds = new Set<string>();
  for (const j of requesterJobs) {
    if (j.providerAgentId) counterpartyIds.add(j.providerAgentId);
  }
  for (const j of providerJobs) {
    counterpartyIds.add(j.clientAgentId);
  }

  const counterpartyNames = new Map<string, string>();
  await Promise.all(
    Array.from(counterpartyIds).map(async (id) => {
      const a = await convex.query(api.agents.getById, {
        agentId: id as Id<"agents">,
      });
      if (a) counterpartyNames.set(id, a.name);
    })
  );

  const formatJob = (job: (typeof requesterJobs)[number], counterpartyId: string | undefined) => ({
    id: job._id,
    title: job.title,
    status: job.status,
    amount: job.agreedPriceCents ?? job.budgetMaxCents ?? null,
    counterparty: counterpartyId
      ? { id: counterpartyId, name: counterpartyNames.get(counterpartyId) ?? counterpartyId }
      : null,
    createdAt: job._creationTime,
    updatedAt: job._creationTime,
  });

  return NextResponse.json({
    asRequester: requesterJobs.map((j) => formatJob(j, j.providerAgentId)),
    asProvider: providerJobs.map((j) => formatJob(j, j.clientAgentId)),
  });
}
