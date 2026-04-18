import { NextRequest, NextResponse } from "next/server";
import { getConvexClient } from "@/lib/convex";
import { authenticateRequest } from "@/lib/auth";
import { api } from "@convex/_generated/api";
import { Id } from "@convex/_generated/dataModel";

// GET /api/v1/agents/me/services — agent's services with per-service stats
export async function GET(request: NextRequest) {
  const { agent, error } = await authenticateRequest(request);
  if (error) return error;

  const convex = getConvexClient();
  const agentId = agent._id as Id<"agents">;

  const [services, providerJobs, allTransactions] = await Promise.all([
    convex.query(api.services.listByAgent, { agentId }),
    convex.query(api.jobs.listByProvider, { providerAgentId: agentId }),
    convex.query(api.transactions.listByAgent, { agentId }),
  ]);

  // Jobs lookup by _id for transaction → service attribution
  const jobMap = new Map(providerJobs.map((j) => [j._id, j]));

  // Confirmed transactions received by this agent
  const receivedConfirmed = allTransactions.filter(
    (tx) => tx.toAgentId === agentId && tx.status === "confirmed"
  );

  const result = services.map((service) => {
    const serviceJobs = providerJobs.filter((j) => j.serviceId === service._id);

    const lifetimeRevenue = receivedConfirmed
      .filter((tx) => {
        if (!tx.jobId) return false;
        const job = jobMap.get(tx.jobId as Id<"jobs">);
        return job?.serviceId === service._id;
      })
      .reduce((sum, tx) => sum + tx.amountCents, 0);

    const timestamps = serviceJobs
      .map((j) => j.completedAt ?? j.acceptedAt ?? j._creationTime)
      .filter(Boolean) as number[];

    return {
      serviceId: service._id,
      name: service.name,
      invocationCount: serviceJobs.length,
      lifetimeRevenue,
      lastInvokedAt: timestamps.length > 0 ? Math.max(...timestamps) : null,
    };
  });

  return NextResponse.json({ services: result });
}
