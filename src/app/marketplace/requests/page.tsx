"use client";

import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import Link from "next/link";

const statusColors: Record<string, string> = {
  open: "bg-blue-500/10 text-blue-400",
  accepted: "bg-yellow-500/10 text-yellow-400",
  in_progress: "bg-orange-500/10 text-orange-400",
  delivered: "bg-purple-500/10 text-purple-400",
  completed: "bg-primary/10 text-primary",
  disputed: "bg-red-500/10 text-red-400",
  cancelled: "bg-muted text-muted-foreground",
  failed: "bg-red-500/10 text-red-400",
};

export default function RequestsPage() {
  const jobs = useQuery(api.jobs.listAll, {});

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <h2 className="text-2xl font-bold text-foreground">Requests</h2>
        <span className="text-sm text-muted-foreground">
          {jobs?.length ?? 0} total requests
        </span>
      </div>

      {!jobs ? (
        <div className="text-muted-foreground">Loading...</div>
      ) : jobs.length === 0 ? (
        <div className="bg-card border border-border rounded-xl p-12 text-center">
          <p className="text-muted-foreground mb-2">No requests yet</p>
          <p className="text-sm text-muted-foreground/60">
            Post a request via{" "}
            <code className="bg-secondary px-1.5 py-0.5 rounded font-mono">
              POST /api/v1/requests
            </code>
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {jobs.map((job) => (
            <Link
              key={job._id}
              href={`/marketplace/requests/${job._id}`}
              className="block bg-card border border-border rounded-xl p-5 hover:border-primary/50 transition-colors"
            >
              <div className="flex items-start justify-between mb-2">
                <div className="flex items-center gap-2">
                  <h3 className="font-semibold text-foreground">{job.title}</h3>
                  <span
                    className={`text-xs px-2 py-0.5 rounded-full ${
                      job.jobType === "open"
                        ? "bg-blue-500/10 text-blue-400"
                        : "bg-secondary text-muted-foreground"
                    }`}
                  >
                    {job.jobType}
                  </span>
                </div>
                <span
                  className={`text-xs px-2 py-0.5 rounded-full ${statusColors[job.status] || "bg-secondary text-muted-foreground"}`}
                >
                  {job.status.replace("_", " ")}
                </span>
              </div>

              <p className="text-sm text-muted-foreground mb-3 line-clamp-2">
                {job.description}
              </p>

              <div className="flex items-center gap-4 text-xs text-muted-foreground/60">
                {job.agreedPriceCents && (
                  <span className="font-mono text-primary">
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
