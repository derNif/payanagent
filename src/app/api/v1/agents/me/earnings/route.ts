import { NextRequest, NextResponse } from "next/server";
import { getConvexClient } from "@/lib/convex";
import { authenticateRequest } from "@/lib/auth";
import { api } from "@convex/_generated/api";
import { Id } from "@convex/_generated/dataModel";

const DAY_MS = 24 * 60 * 60 * 1000;

// GET /api/v1/agents/me/earnings — aggregate earnings (USDC in cents)
export async function GET(request: NextRequest) {
  const { agent, error } = await authenticateRequest(request);
  if (error) return error;

  const convex = getConvexClient();
  const agentId = agent._id as Id<"agents">;

  const allTransactions = await convex.query(api.transactions.listByAgent, { agentId });

  // Only confirmed payments received by this agent (not sent)
  const received = allTransactions.filter(
    (tx) =>
      tx.toAgentId === agentId &&
      tx.status === "confirmed" &&
      (tx.type === "escrow_release" || tx.type === "direct_payment")
  );

  const now = Date.now();
  let last7d = 0;
  let last30d = 0;

  // Collect job IDs for service attribution
  const jobIds = [...new Set(received.filter((tx) => tx.jobId).map((tx) => tx.jobId as string))];
  const jobServiceMap = new Map<string, string>(); // jobId → serviceId
  const serviceNameMap = new Map<string, string>(); // serviceId → service name

  if (jobIds.length > 0) {
    await Promise.all(
      jobIds.map(async (jobId) => {
        const job = await convex.query(api.jobs.getById, {
          jobId: jobId as Id<"jobs">,
        });
        if (job?.serviceId) {
          jobServiceMap.set(jobId, job.serviceId as string);
          if (!serviceNameMap.has(job.serviceId as string)) {
            // Will populate below
            serviceNameMap.set(job.serviceId as string, "");
          }
        }
      })
    );

    await Promise.all(
      Array.from(serviceNameMap.keys()).map(async (serviceId) => {
        const svc = await convex.query(api.services.getById, {
          serviceId: serviceId as Id<"services">,
        });
        if (svc) serviceNameMap.set(serviceId, svc.name);
      })
    );
  }

  const serviceRevenue = new Map<string, number>();

  for (const tx of received) {
    if (tx.confirmedAt) {
      const age = now - tx.confirmedAt;
      if (age < 7 * DAY_MS) last7d += tx.amountCents;
      if (age < 30 * DAY_MS) last30d += tx.amountCents;
    }

    if (tx.jobId) {
      const serviceId = jobServiceMap.get(tx.jobId as string);
      const serviceName = serviceId ? (serviceNameMap.get(serviceId) ?? "Unknown") : "Other";
      serviceRevenue.set(serviceName, (serviceRevenue.get(serviceName) ?? 0) + tx.amountCents);
    }
  }

  return NextResponse.json({
    totalEarnedUsdc: agent.totalEarned,
    last7d,
    last30d,
    lifetime: agent.totalEarned,
    byServiceType: Array.from(serviceRevenue.entries()).map(([service, usdc]) => ({
      service,
      usdc,
    })),
  });
}
