"use client";

import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { Id } from "@convex/_generated/dataModel";
import { use } from "react";
import Link from "next/link";

const statusColors: Record<string, string> = {
  open: "bg-blue-500/10 text-blue-400",
  accepted: "bg-yellow-500/10 text-yellow-400",
  fulfilled: "bg-purple-500/10 text-purple-400",
  approved: "bg-primary/10 text-primary",
  cancelled: "bg-muted text-muted-foreground",
  disputed: "bg-red-500/10 text-red-400",
};

const bidStatusColors: Record<string, string> = {
  pending: "bg-blue-500/10 text-blue-400",
  accepted: "bg-primary/10 text-primary",
  rejected: "bg-muted text-muted-foreground",
  withdrawn: "bg-muted text-muted-foreground",
};

export default function RequestDetailPage({
  params,
}: {
  params: Promise<{ requestId: string }>;
}) {
  const { requestId } = use(params);
  const data = useQuery(api.requests.getWithBids, {
    requestId: requestId as Id<"requests">,
  });

  if (!data || data.request === null) {
    return <div className="text-muted-foreground">Loading...</div>;
  }
  const { request, bids } = data;

  return (
    <div>
      <Link
        href="/marketplace/requests"
        className="text-sm text-muted-foreground hover:text-foreground mb-4 inline-block"
      >
        &larr; Back to requests
      </Link>

      <div className="bg-card border border-border rounded-xl p-6 mb-6">
        <div className="flex items-start justify-between mb-4 gap-3 flex-wrap">
          <div className="flex items-center gap-2 flex-wrap min-w-0">
            <h2 className="text-2xl font-bold text-foreground">{request.title}</h2>
            {request.escrow && (
              <span className="text-xs px-2 py-0.5 rounded font-mono bg-green-500/10 text-green-400">
                escrow
              </span>
            )}
          </div>
          <span
            className={`text-xs px-2 py-0.5 rounded-full shrink-0 ${
              statusColors[request.status] ?? "bg-secondary text-muted-foreground"
            }`}
          >
            {request.status}
          </span>
        </div>

        <p className="text-muted-foreground mb-6 whitespace-pre-wrap">
          {request.description}
        </p>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
          <div>
            <p className="text-xs text-muted-foreground/60 mb-1">Budget</p>
            <p className="font-mono text-primary">
              ${(request.budgetMaxCents / 100).toFixed(2)}
            </p>
          </div>
          {request.agreedPriceCents !== undefined && (
            <div>
              <p className="text-xs text-muted-foreground/60 mb-1">Agreed price</p>
              <p className="font-mono text-primary">
                ${(request.agreedPriceCents / 100).toFixed(2)}
              </p>
            </div>
          )}
          <div>
            <p className="text-xs text-muted-foreground/60 mb-1">Posted</p>
            <p className="font-mono text-foreground">
              {new Date(request._creationTime).toLocaleDateString()}
            </p>
          </div>
          {request.acceptedAt && (
            <div>
              <p className="text-xs text-muted-foreground/60 mb-1">Accepted</p>
              <p className="font-mono text-foreground">
                {new Date(request.acceptedAt).toLocaleDateString()}
              </p>
            </div>
          )}
        </div>

        {request.inputPayload && (
          <div className="mt-6">
            <p className="text-xs text-muted-foreground/60 mb-1">Input</p>
            <pre className="text-xs bg-secondary/40 p-3 rounded overflow-auto">
              {request.inputPayload}
            </pre>
          </div>
        )}

        {request.outputPayload && (
          <div className="mt-6">
            <p className="text-xs text-muted-foreground/60 mb-1">Delivered output</p>
            <pre className="text-xs bg-secondary/40 p-3 rounded overflow-auto whitespace-pre-wrap">
              {request.outputPayload}
            </pre>
          </div>
        )}
      </div>

      {bids.length > 0 && (
        <div className="bg-card border border-border rounded-xl p-6">
          <h3 className="font-semibold text-foreground mb-4">
            Bids ({bids.length})
          </h3>
          <div className="space-y-3">
            {bids.map((bid) => (
              <div
                key={bid._id}
                className="border border-border rounded-lg p-4 flex items-start justify-between gap-3"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <p className="font-mono text-primary">
                      ${(bid.priceCents / 100).toFixed(2)}
                    </p>
                    <span
                      className={`text-xs px-2 py-0.5 rounded font-mono ${
                        bidStatusColors[bid.status] ?? "bg-secondary text-muted-foreground"
                      }`}
                    >
                      {bid.status}
                    </span>
                  </div>
                  {bid.message && (
                    <p className="text-sm text-muted-foreground">{bid.message}</p>
                  )}
                  {bid.estimatedDurationSeconds !== undefined && (
                    <p className="text-xs text-muted-foreground/60 mt-1">
                      ETA: {Math.round(bid.estimatedDurationSeconds / 60)} min
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
