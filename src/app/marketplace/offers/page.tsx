"use client";

import { useQuery } from "convex/react";
import { useState } from "react";
import { api } from "@convex/_generated/api";

type OfferTypeFilter = "all" | "api" | "download";

export default function OffersPage() {
  const [filter, setFilter] = useState<OfferTypeFilter>("all");
  const offers = useQuery(api.offers.listActive, {
    offerType: filter === "all" ? undefined : filter,
    limit: 200,
  });

  return (
    <div>
      <div className="flex items-center justify-between mb-6 gap-3 flex-wrap">
        <h2 className="text-2xl font-bold text-foreground">Offers</h2>
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">
            {offers?.length ?? 0} active
          </span>
          <div className="flex gap-1 ml-3">
            {(["all", "api", "download"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setFilter(t)}
                className={
                  filter === t
                    ? "text-xs px-3 py-1 rounded bg-primary text-primary-foreground font-mono"
                    : "text-xs px-3 py-1 rounded bg-secondary text-muted-foreground hover:text-foreground font-mono"
                }
              >
                {t}
              </button>
            ))}
          </div>
        </div>
      </div>

      {!offers ? (
        <div className="text-muted-foreground">Loading...</div>
      ) : offers.length === 0 ? (
        <div className="bg-card border border-border rounded-xl p-12 text-center">
          <p className="text-muted-foreground mb-2">No offers listed yet</p>
          <p className="text-sm text-muted-foreground/60">
            Create one via{" "}
            <code className="bg-secondary px-1.5 py-0.5 rounded font-mono">
              POST /api/v1/offers
            </code>
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {offers.map((offer) => (
            <div
              key={offer._id}
              className="bg-card border border-border rounded-xl p-5 flex items-start justify-between gap-4"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-2 flex-wrap">
                  <h3 className="font-semibold text-foreground">{offer.title}</h3>
                  <span
                    className={`text-xs px-2 py-0.5 rounded-full font-mono ${
                      offer.offerType === "api"
                        ? "bg-primary/10 text-primary"
                        : "bg-blue-500/10 text-blue-400"
                    }`}
                  >
                    {offer.offerType}
                  </span>
                  <span className="text-xs bg-secondary text-muted-foreground px-2 py-0.5 rounded">
                    {offer.category}
                  </span>
                </div>
                <p className="text-sm text-muted-foreground mb-2 line-clamp-2">
                  {offer.description}
                </p>
                <div className="flex flex-wrap gap-1">
                  {offer.tags.map((tag) => (
                    <span
                      key={tag}
                      className="text-xs bg-secondary/50 text-muted-foreground/60 px-1.5 py-0.5 rounded"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              </div>

              <div className="text-right shrink-0">
                <p className="text-lg font-mono text-primary">
                  ${(offer.priceCents / 100).toFixed(2)}
                </p>
                <p className="text-xs text-muted-foreground/60">
                  per call
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
