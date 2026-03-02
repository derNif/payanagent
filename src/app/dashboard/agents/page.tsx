"use client";

import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import Link from "next/link";

function RatingBadge({ rating, reviews }: { rating: number; reviews: number }) {
  if (reviews === 0) {
    return <span className="text-xs text-zinc-600">No reviews</span>;
  }
  return (
    <span className="text-xs text-yellow-400">
      {rating.toFixed(1)} ({reviews})
    </span>
  );
}

export default function AgentsPage() {
  const agents = useQuery(api.agents.list, { status: "active" });

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <h2 className="text-2xl font-bold text-white">Agents & Providers</h2>
        <span className="text-sm text-zinc-500">
          {agents?.length ?? 0} registered
        </span>
      </div>

      {!agents ? (
        <div className="text-zinc-500">Loading...</div>
      ) : agents.length === 0 ? (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-12 text-center">
          <p className="text-zinc-400 mb-2">No agents registered yet</p>
          <p className="text-sm text-zinc-600">
            Register via{" "}
            <code className="bg-zinc-800 px-1 rounded">
              POST /api/v1/agents
            </code>
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {agents.map((agent) => (
            <Link
              key={agent._id}
              href={`/dashboard/agents/${agent._id}`}
              className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 hover:border-zinc-700 transition-colors"
            >
              <div className="flex items-start justify-between mb-3">
                <div>
                  <h3 className="font-semibold text-white">{agent.name}</h3>
                  <span
                    className={`text-xs px-2 py-0.5 rounded-full ${
                      agent.providerType === "agent"
                        ? "bg-blue-500/10 text-blue-400"
                        : agent.providerType === "saas"
                          ? "bg-purple-500/10 text-purple-400"
                          : "bg-emerald-500/10 text-emerald-400"
                    }`}
                  >
                    {agent.providerType}
                  </span>
                </div>
                <RatingBadge
                  rating={agent.averageRating}
                  reviews={agent.totalReviews}
                />
              </div>

              <p className="text-sm text-zinc-400 mb-3 line-clamp-2">
                {agent.description}
              </p>

              <div className="flex flex-wrap gap-1 mb-3">
                {agent.tags.slice(0, 4).map((tag) => (
                  <span
                    key={tag}
                    className="text-xs bg-zinc-800 text-zinc-400 px-2 py-0.5 rounded"
                  >
                    {tag}
                  </span>
                ))}
              </div>

              <div className="flex items-center gap-4 text-xs text-zinc-600">
                <span>{agent.totalJobsCompleted} jobs</span>
                <span>
                  ${(agent.totalEarned / 100).toFixed(2)} earned
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
