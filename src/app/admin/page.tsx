"use client";

import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { Suspense } from "react";
import Link from "next/link";

// Auth is handled server-side by middleware (checks ADMIN_KEY env var)

function AdminDashboard() {
  const agentStats = useQuery(api.agents.getStats);
  const jobStats = useQuery(api.jobs.getStats);
  const volumeStats = useQuery(api.transactions.getVolumeStats);
  const allAgents = useQuery(api.agents.list, {});
  const allJobs = useQuery(api.jobs.listAll, {});
  const allTransactions = useQuery(api.transactions.listAll);

  const loading = !agentStats || !jobStats || !volumeStats;

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold">Admin Dashboard</h1>
            <p className="text-sm text-muted-foreground">PayanAgent platform overview</p>
          </div>
          <Link
            href="/marketplace"
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            &larr; Marketplace
          </Link>
        </div>

        {loading ? (
          <div className="text-muted-foreground">Loading stats...</div>
        ) : (
          <>
            {/* Top-level stats */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
              <StatCard
                label="Total Agents"
                value={agentStats.total}
                detail={`${agentStats.active} active, ${agentStats.suspended} suspended`}
              />
              <StatCard
                label="Total Requests"
                value={jobStats.total}
                detail={Object.entries(jobStats.byStatus)
                  .map(([s, c]) => `${c} ${s}`)
                  .join(", ")}
              />
              <StatCard
                label="Total Volume"
                value={`$${(volumeStats.totalVolume / 100).toFixed(2)}`}
                detail={`${volumeStats.totalTransactions} transactions`}
              />
              <StatCard
                label="Last 7 Days"
                value={`$${(volumeStats.last7d / 100).toFixed(2)}`}
                detail={`24h: $${(volumeStats.last24h / 100).toFixed(2)}`}
              />
            </div>

            {/* Jobs by status */}
            <div className="mb-8">
              <h2 className="text-lg font-semibold mb-4">Requests by Status</h2>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3">
                {Object.entries(jobStats.byStatus).map(([status, count]) => (
                  <div
                    key={status}
                    className="bg-card border border-border rounded-lg p-3 text-center"
                  >
                    <div className="text-xl font-bold font-mono">{count as number}</div>
                    <div className="text-xs text-muted-foreground capitalize">{status}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Recent Agents */}
            <div className="mb-8">
              <h2 className="text-lg font-semibold mb-4">
                Agents ({allAgents?.length || 0})
              </h2>
              <div className="bg-card border border-border rounded-xl overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border bg-secondary/30">
                        <th className="text-left px-4 py-2 font-medium text-muted-foreground">Name</th>
                        <th className="text-left px-4 py-2 font-medium text-muted-foreground">Type</th>
                        <th className="text-left px-4 py-2 font-medium text-muted-foreground">Rating</th>
                        <th className="text-left px-4 py-2 font-medium text-muted-foreground">Jobs</th>
                        <th className="text-left px-4 py-2 font-medium text-muted-foreground">Earned</th>
                        <th className="text-left px-4 py-2 font-medium text-muted-foreground">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(allAgents || []).slice(0, 50).map((agent) => (
                        <tr key={agent._id} className="border-b border-border/50 hover:bg-secondary/10">
                          <td className="px-4 py-2">
                            <Link
                              href={`/marketplace/agents/${agent._id}`}
                              className="text-primary hover:underline"
                            >
                              {agent.name}
                            </Link>
                          </td>
                          <td className="px-4 py-2 text-muted-foreground">{agent.providerType}</td>
                          <td className="px-4 py-2 font-mono">
                            {agent.totalReviews > 0
                              ? `${agent.averageRating.toFixed(1)} (${agent.totalReviews})`
                              : "—"}
                          </td>
                          <td className="px-4 py-2 font-mono">{agent.totalJobsCompleted}</td>
                          <td className="px-4 py-2 font-mono text-primary">
                            ${(agent.totalEarned / 100).toFixed(2)}
                          </td>
                          <td className="px-4 py-2">
                            <span
                              className={`text-xs px-2 py-0.5 rounded-full ${
                                agent.status === "active"
                                  ? "bg-green-500/10 text-green-400"
                                  : "bg-red-500/10 text-red-400"
                              }`}
                            >
                              {agent.status}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            {/* Recent Requests */}
            <div className="mb-8">
              <h2 className="text-lg font-semibold mb-4">
                Recent Requests ({allJobs?.length || 0})
              </h2>
              <div className="bg-card border border-border rounded-xl overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border bg-secondary/30">
                        <th className="text-left px-4 py-2 font-medium text-muted-foreground">Title</th>
                        <th className="text-left px-4 py-2 font-medium text-muted-foreground">Type</th>
                        <th className="text-left px-4 py-2 font-medium text-muted-foreground">Status</th>
                        <th className="text-left px-4 py-2 font-medium text-muted-foreground">Price</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(allJobs || []).slice(0, 50).map((job) => (
                        <tr key={job._id} className="border-b border-border/50 hover:bg-secondary/10">
                          <td className="px-4 py-2">
                            <Link
                              href={`/marketplace/requests/${job._id}`}
                              className="text-primary hover:underline"
                            >
                              {job.title}
                            </Link>
                          </td>
                          <td className="px-4 py-2 text-muted-foreground">{job.jobType}</td>
                          <td className="px-4 py-2">
                            <StatusBadge status={job.status} />
                          </td>
                          <td className="px-4 py-2 font-mono">
                            {job.agreedPriceCents
                              ? `$${(job.agreedPriceCents / 100).toFixed(2)}`
                              : job.budgetMaxCents
                                ? `≤$${(job.budgetMaxCents / 100).toFixed(2)}`
                                : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            {/* Recent Transactions */}
            <div>
              <h2 className="text-lg font-semibold mb-4">
                Recent Transactions ({allTransactions?.length || 0})
              </h2>
              <div className="bg-card border border-border rounded-xl overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border bg-secondary/30">
                        <th className="text-left px-4 py-2 font-medium text-muted-foreground">Type</th>
                        <th className="text-left px-4 py-2 font-medium text-muted-foreground">Amount</th>
                        <th className="text-left px-4 py-2 font-medium text-muted-foreground">Status</th>
                        <th className="text-left px-4 py-2 font-medium text-muted-foreground">Tx Hash</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(allTransactions || []).slice(0, 50).map((tx) => (
                        <tr key={tx._id} className="border-b border-border/50 hover:bg-secondary/10">
                          <td className="px-4 py-2 capitalize">{tx.type.replace("_", " ")}</td>
                          <td className="px-4 py-2 font-mono text-primary">
                            ${(tx.amountCents / 100).toFixed(2)}
                          </td>
                          <td className="px-4 py-2">
                            <StatusBadge status={tx.status} />
                          </td>
                          <td className="px-4 py-2 font-mono text-xs text-muted-foreground">
                            {tx.txHash ? (
                              <a
                                href={`https://basescan.org/tx/${tx.txHash}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="hover:text-foreground"
                              >
                                {tx.txHash.slice(0, 10)}...
                              </a>
                            ) : (
                              "—"
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  detail,
}: {
  label: string;
  value: string | number;
  detail: string;
}) {
  return (
    <div className="bg-card border border-border rounded-xl p-4 sm:p-6">
      <p className="text-xs text-muted-foreground mb-1">{label}</p>
      <p className="text-2xl font-bold font-mono">{value}</p>
      <p className="text-xs text-muted-foreground/60 mt-1 truncate">{detail}</p>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    active: "bg-blue-500/10 text-blue-400",
    pending: "bg-yellow-500/10 text-yellow-400",
    open: "bg-yellow-500/10 text-yellow-400",
    accepted: "bg-blue-500/10 text-blue-400",
    delivered: "bg-purple-500/10 text-purple-400",
    completing: "bg-purple-500/10 text-purple-400",
    completed: "bg-green-500/10 text-green-400",
    confirmed: "bg-green-500/10 text-green-400",
    disputed: "bg-red-500/10 text-red-400",
    cancelled: "bg-muted text-muted-foreground",
    failed: "bg-red-500/10 text-red-400",
  };

  return (
    <span className={`text-xs px-2 py-0.5 rounded-full ${colors[status] || "bg-secondary text-muted-foreground"}`}>
      {status}
    </span>
  );
}

export default function AdminPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-background flex items-center justify-center text-muted-foreground">Loading...</div>}>
      <AdminDashboard />
    </Suspense>
  );
}

// Note: This page is protected by middleware.ts
// Set ADMIN_KEY env var in Vercel, access via /admin?key=YOUR_SECRET
// The key never touches client-side code
