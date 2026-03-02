"use client";

import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import Link from "next/link";

const statusColors: Record<string, string> = {
  open: "bg-blue-500/10 text-blue-400",
  accepted: "bg-yellow-500/10 text-yellow-400",
  in_progress: "bg-orange-500/10 text-orange-400",
  delivered: "bg-purple-500/10 text-purple-400",
  completed: "bg-emerald-500/10 text-emerald-400",
  disputed: "bg-red-500/10 text-red-400",
  cancelled: "bg-zinc-500/10 text-zinc-400",
  failed: "bg-red-500/10 text-red-400",
};

export default function JobsPage() {
  const jobs = useQuery(api.jobs.listAll, {});

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <h2 className="text-2xl font-bold text-white">Job Marketplace</h2>
        <span className="text-sm text-zinc-500">
          {jobs?.length ?? 0} total jobs
        </span>
      </div>

      {!jobs ? (
        <div className="text-zinc-500">Loading...</div>
      ) : jobs.length === 0 ? (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-12 text-center">
          <p className="text-zinc-400 mb-2">No jobs yet</p>
          <p className="text-sm text-zinc-600">
            Create a job via{" "}
            <code className="bg-zinc-800 px-1 rounded">
              POST /api/v1/jobs
            </code>
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {jobs.map((job) => (
            <Link
              key={job._id}
              href={`/dashboard/jobs/${job._id}`}
              className="block bg-zinc-900 border border-zinc-800 rounded-xl p-5 hover:border-zinc-700 transition-colors"
            >
              <div className="flex items-start justify-between mb-2">
                <div className="flex items-center gap-2">
                  <h3 className="font-semibold text-white">{job.title}</h3>
                  <span
                    className={`text-xs px-2 py-0.5 rounded-full ${
                      job.jobType === "open"
                        ? "bg-blue-500/10 text-blue-400"
                        : "bg-zinc-800 text-zinc-400"
                    }`}
                  >
                    {job.jobType}
                  </span>
                </div>
                <span
                  className={`text-xs px-2 py-0.5 rounded-full ${statusColors[job.status] || "bg-zinc-800 text-zinc-400"}`}
                >
                  {job.status.replace("_", " ")}
                </span>
              </div>

              <p className="text-sm text-zinc-400 mb-3 line-clamp-2">
                {job.description}
              </p>

              <div className="flex items-center gap-4 text-xs text-zinc-600">
                {job.agreedPriceCents && (
                  <span className="font-mono text-emerald-400">
                    ${(job.agreedPriceCents / 100).toFixed(2)}
                  </span>
                )}
                {job.budgetMaxCents && (
                  <span>
                    Budget: ${(job.budgetMaxCents / 100).toFixed(2)}
                  </span>
                )}
                <span>
                  Created{" "}
                  {new Date(job._creationTime).toLocaleDateString()}
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
