"use client";

import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import Link from "next/link";

const statusColors: Record<string, string> = {
  open: "bg-blue-500/10 text-blue-400",
  accepted: "bg-yellow-500/10 text-yellow-400",
  fulfilled: "bg-purple-500/10 text-purple-400",
  approved: "bg-primary/10 text-primary",
  cancelled: "bg-muted text-muted-foreground",
  disputed: "bg-red-500/10 text-red-400",
};

export default function RequestsPage() {
  const requests = useQuery(api.requests.listOpen, { limit: 100 });

  return (
    <div>
      <div className="flex items-center justify-between mb-8 gap-3 flex-wrap">
        <div>
          <h2 className="text-2xl font-bold text-foreground mb-1">Open requests</h2>
          <p className="text-sm text-muted-foreground">
            Bespoke work buyers want done. Bid on anything you can deliver.
          </p>
        </div>
        <span className="text-sm text-muted-foreground font-mono">
          {requests?.length ?? 0} open
        </span>
      </div>

      {!requests ? (
        <div className="text-muted-foreground">Loading...</div>
      ) : requests.length === 0 ? (
        <div className="bg-card border border-border rounded-xl p-12 text-center card-shadow">
          <p className="text-foreground mb-2 font-mono">No open requests right now</p>
          <p className="text-sm text-muted-foreground/60 mb-6">
            Need something no offer covers? Post bespoke work with a budget and let
            providers bid — escrow optional, automatic refund on timeout.
          </p>
          <a href="/docs/buyer" className="text-sm font-mono text-primary hover:underline">
            Post the first request →
          </a>
        </div>
      ) : (
        <div className="space-y-3">
          {requests.map((req) => (
            <Link
              key={req._id}
              href={`/marketplace/requests/${req._id}`}
              className="block bg-card border border-border rounded-xl p-5 card-shadow hover:border-primary/50 transition-colors"
            >
              <div className="flex items-start justify-between mb-2 gap-3">
                <div className="flex items-center gap-2 flex-wrap min-w-0">
                  <h3 className="font-semibold text-foreground truncate">
                    {req.title}
                  </h3>
                  {req.escrow && (
                    <span className="text-xs px-2 py-0.5 rounded font-mono bg-green-500/10 text-green-400">
                      escrow
                    </span>
                  )}
                </div>
                <span
                  className={`text-xs px-2 py-0.5 rounded-none shrink-0 ${
                    statusColors[req.status] ?? "bg-secondary text-muted-foreground"
                  }`}
                >
                  {req.status}
                </span>
              </div>
              <p className="text-sm text-muted-foreground mb-3 line-clamp-2">
                {req.description}
              </p>
              <div className="flex items-center gap-4 text-xs text-muted-foreground/60 flex-wrap">
                <span className="font-mono text-primary">
                  ${(req.budgetMaxCents / 100).toFixed(2)}
                </span>
                <span>
                  Posted {new Date(req._creationTime).toLocaleDateString()}
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
