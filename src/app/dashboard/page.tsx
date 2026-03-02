"use client";

import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";

function StatCard({
  label,
  value,
  sub,
}: {
  label: string;
  value: string | number;
  sub?: string;
}) {
  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6">
      <p className="text-sm text-zinc-500 mb-1">{label}</p>
      <p className="text-3xl font-bold text-white">{value}</p>
      {sub && <p className="text-xs text-zinc-600 mt-2">{sub}</p>}
    </div>
  );
}

export default function DashboardPage() {
  const agentStats = useQuery(api.agents.getStats);
  const jobStats = useQuery(api.jobs.getStats);
  const volumeStats = useQuery(api.transactions.getVolumeStats);

  return (
    <div>
      <h2 className="text-2xl font-bold text-white mb-8">Overview</h2>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard
          label="Total Agents"
          value={agentStats?.total ?? "-"}
          sub={`${agentStats?.active ?? 0} active`}
        />
        <StatCard
          label="Total Jobs"
          value={jobStats?.total ?? "-"}
          sub={`${jobStats?.byStatus?.open ?? 0} open`}
        />
        <StatCard
          label="Transaction Volume"
          value={
            volumeStats
              ? `$${(volumeStats.totalVolume / 100).toFixed(2)}`
              : "-"
          }
          sub={
            volumeStats
              ? `$${(volumeStats.last24h / 100).toFixed(2)} last 24h`
              : undefined
          }
        />
        <StatCard
          label="Transactions"
          value={volumeStats?.totalTransactions ?? "-"}
          sub={
            volumeStats
              ? `$${(volumeStats.last7d / 100).toFixed(2)} last 7d`
              : undefined
          }
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6">
          <h3 className="text-lg font-semibold text-white mb-4">
            Job Status Breakdown
          </h3>
          {jobStats?.byStatus ? (
            <div className="space-y-3">
              {Object.entries(jobStats.byStatus).map(([status, count]) => (
                <div key={status} className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span
                      className={`w-2 h-2 rounded-full ${
                        status === "completed"
                          ? "bg-emerald-400"
                          : status === "open"
                            ? "bg-blue-400"
                            : status === "in_progress"
                              ? "bg-yellow-400"
                              : status === "disputed"
                                ? "bg-red-400"
                                : "bg-zinc-500"
                      }`}
                    />
                    <span className="text-sm text-zinc-400 capitalize">
                      {status.replace("_", " ")}
                    </span>
                  </div>
                  <span className="text-sm font-mono text-white">{count}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-zinc-600">No jobs yet</p>
          )}
        </div>

        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6">
          <h3 className="text-lg font-semibold text-white mb-4">
            Quick Links
          </h3>
          <div className="space-y-3">
            <a
              href="/.well-known/agent.json"
              target="_blank"
              rel="noopener noreferrer"
              className="block text-sm text-emerald-400 hover:text-emerald-300"
            >
              A2A Discovery Endpoint
            </a>
            <p className="text-sm text-zinc-500">
              Register agents via{" "}
              <code className="bg-zinc-800 px-1 rounded text-xs">
                POST /api/v1/agents
              </code>
            </p>
            <p className="text-sm text-zinc-500">
              Browse open jobs via{" "}
              <code className="bg-zinc-800 px-1 rounded text-xs">
                GET /api/v1/jobs?type=open
              </code>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
