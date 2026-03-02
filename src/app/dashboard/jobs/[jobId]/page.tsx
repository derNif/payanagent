"use client";

import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { Id } from "@convex/_generated/dataModel";
import { use } from "react";
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

export default function JobDetailPage({
  params,
}: {
  params: Promise<{ jobId: string }>;
}) {
  const { jobId } = use(params);
  const job = useQuery(api.jobs.getById, {
    jobId: jobId as Id<"jobs">,
  });
  const bids = useQuery(api.bids.listByJob, {
    jobId: jobId as Id<"jobs">,
  });
  const reviews = useQuery(api.reviews.listByJob, {
    jobId: jobId as Id<"jobs">,
  });

  if (!job) {
    return <div className="text-zinc-500">Loading...</div>;
  }

  return (
    <div>
      <Link
        href="/dashboard/jobs"
        className="text-sm text-zinc-500 hover:text-zinc-300 mb-4 inline-block"
      >
        &larr; Back to jobs
      </Link>

      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 mb-6">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h2 className="text-2xl font-bold text-white mb-1">{job.title}</h2>
            <div className="flex items-center gap-2">
              <span
                className={`text-xs px-2 py-0.5 rounded-full ${
                  job.jobType === "open"
                    ? "bg-blue-500/10 text-blue-400"
                    : "bg-zinc-800 text-zinc-400"
                }`}
              >
                {job.jobType}
              </span>
              <span
                className={`text-xs px-2 py-0.5 rounded-full ${statusColors[job.status]}`}
              >
                {job.status.replace("_", " ")}
              </span>
            </div>
          </div>
          <div className="text-right">
            {job.agreedPriceCents && (
              <p className="text-xl font-mono text-emerald-400">
                ${(job.agreedPriceCents / 100).toFixed(2)}
              </p>
            )}
            {job.budgetMaxCents && (
              <p className="text-sm text-zinc-500">
                Budget: ${(job.budgetMaxCents / 100).toFixed(2)}
              </p>
            )}
          </div>
        </div>

        <p className="text-zinc-400 mb-4">{job.description}</p>

        {job.inputPayload && (
          <div className="mb-4">
            <p className="text-xs text-zinc-600 mb-1">Input Payload</p>
            <pre className="bg-zinc-950 border border-zinc-800 rounded-lg p-3 text-xs text-zinc-400 overflow-auto">
              {JSON.stringify(JSON.parse(job.inputPayload), null, 2)}
            </pre>
          </div>
        )}

        {job.outputPayload && (
          <div className="mb-4">
            <p className="text-xs text-zinc-600 mb-1">Deliverable</p>
            <pre className="bg-zinc-950 border border-zinc-800 rounded-lg p-3 text-xs text-zinc-400 overflow-auto">
              {JSON.stringify(JSON.parse(job.outputPayload), null, 2)}
            </pre>
          </div>
        )}

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs border-t border-zinc-800 pt-4 mt-4">
          <div>
            <p className="text-zinc-600">Created</p>
            <p className="text-zinc-400">
              {new Date(job._creationTime).toLocaleString()}
            </p>
          </div>
          {job.acceptedAt && (
            <div>
              <p className="text-zinc-600">Accepted</p>
              <p className="text-zinc-400">
                {new Date(job.acceptedAt).toLocaleString()}
              </p>
            </div>
          )}
          {job.deliveredAt && (
            <div>
              <p className="text-zinc-600">Delivered</p>
              <p className="text-zinc-400">
                {new Date(job.deliveredAt).toLocaleString()}
              </p>
            </div>
          )}
          {job.completedAt && (
            <div>
              <p className="text-zinc-600">Completed</p>
              <p className="text-zinc-400">
                {new Date(job.completedAt).toLocaleString()}
              </p>
            </div>
          )}
        </div>

        {job.disputeReason && (
          <div className="mt-4 p-3 bg-red-500/5 border border-red-500/20 rounded-lg">
            <p className="text-xs text-red-400 font-medium mb-1">
              Dispute Reason
            </p>
            <p className="text-sm text-red-300">{job.disputeReason}</p>
          </div>
        )}
      </div>

      {/* Bids */}
      {bids && bids.length > 0 && (
        <div className="mb-6">
          <h3 className="text-lg font-semibold text-white mb-4">
            Bids ({bids.length})
          </h3>
          <div className="space-y-3">
            {bids.map((bid) => (
              <div
                key={bid._id}
                className={`bg-zinc-900 border rounded-xl p-4 ${
                  bid.status === "accepted"
                    ? "border-emerald-500/30"
                    : "border-zinc-800"
                }`}
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-mono text-emerald-400">
                    ${(bid.priceCents / 100).toFixed(2)}
                  </span>
                  <span
                    className={`text-xs px-2 py-0.5 rounded-full ${
                      bid.status === "accepted"
                        ? "bg-emerald-500/10 text-emerald-400"
                        : bid.status === "rejected"
                          ? "bg-red-500/10 text-red-400"
                          : "bg-zinc-800 text-zinc-400"
                    }`}
                  >
                    {bid.status}
                  </span>
                </div>
                {bid.message && (
                  <p className="text-sm text-zinc-400">{bid.message}</p>
                )}
                {bid.estimatedDurationSeconds && (
                  <p className="text-xs text-zinc-600 mt-1">
                    Est.{" "}
                    {Math.round(bid.estimatedDurationSeconds / 60)} min
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Reviews */}
      {reviews && reviews.length > 0 && (
        <div>
          <h3 className="text-lg font-semibold text-white mb-4">Reviews</h3>
          <div className="space-y-3">
            {reviews.map((review) => (
              <div
                key={review._id}
                className="bg-zinc-900 border border-zinc-800 rounded-xl p-4"
              >
                <span className="text-yellow-400 font-mono text-sm">
                  {"*".repeat(review.rating)}
                  {"_".repeat(5 - review.rating)}
                </span>
                {review.comment && (
                  <p className="text-sm text-zinc-400 mt-1">
                    {review.comment}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
