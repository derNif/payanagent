"use client";

import { useQuery } from "convex/react";
import { useState } from "react";
import Link from "next/link";
import { api } from "@convex/_generated/api";

type OfferTypeFilter = "all" | "api" | "download";

// Human framing: api = service (pay-per-call), download = product (one-time).
// The API wire values stay "api"/"download" — external sellers integrate on them.
const TYPE_LABELS: Record<string, string> = {
  all: "all",
  api: "services",
  download: "products",
};

export default function OffersPage() {
  const [filter, setFilter] = useState<OfferTypeFilter>("all");
  const [copied, setCopied] = useState<string | null>(null);
  const offers = useQuery(api.offers.listActive, {
    offerType: filter === "all" ? undefined : filter,
    limit: 200,
  });

  const copyId = (id: string) => {
    navigator.clipboard.writeText(id).then(() => {
      setCopied(id);
      setTimeout(() => setCopied(null), 1500);
    });
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6 gap-3 flex-wrap">
        <div>
          <h2 className="text-2xl font-bold text-foreground mb-1">Offers</h2>
          <p className="text-sm text-muted-foreground">
            Services (pay-per-call APIs) and products (one-time purchases). Buy any of them with USDC via x402.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground font-mono">
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
                {TYPE_LABELS[t]}
              </button>
            ))}
          </div>
        </div>
      </div>

      {!offers ? (
        <div className="text-muted-foreground">Loading...</div>
      ) : offers.length === 0 ? (
        <div className="bg-card border border-border rounded-xl p-12 text-center card-shadow">
          <p className="text-foreground mb-2 font-mono">Nothing listed in this category yet</p>
          <p className="text-sm text-muted-foreground/60 mb-6">
            Sell what your agent already does — list an offer in one API call and get paid in
            USDC on every invocation. Zero platform fees.
          </p>
          <a href="/docs/seller" className="text-sm font-mono text-primary hover:underline">
            List your first offer →
          </a>
        </div>
      ) : (
        <div className="space-y-3">
          {offers.map((offer) => (
            <div
              key={offer._id}
              className="bg-card border border-border rounded-xl p-5 card-shadow hover:border-primary/30 transition-colors"
            >
              <div className="flex items-start justify-between gap-4">
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
                      {offer.offerType === "api" ? "service" : "product"}
                    </span>
                    <span className="text-xs bg-secondary text-muted-foreground px-2 py-0.5 rounded">
                      {offer.category}
                    </span>
                  </div>
                  <p className="text-sm text-muted-foreground mb-2 line-clamp-2">
                    {offer.description}
                  </p>
                  {offer.inputSchema && (
                    <p className="text-xs font-mono text-muted-foreground/70 bg-secondary/30 rounded px-2 py-1 mb-2 truncate">
                      input: {offer.inputSchema}
                    </p>
                  )}
                  <div className="flex flex-wrap items-center gap-1">
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
                    {offer.offerType === "api" ? "per call" : "one-time"}
                  </p>
                </div>
              </div>

              <div className="mt-3 pt-3 border-t border-border/60 flex items-center justify-between gap-3 flex-wrap text-xs font-mono">
                <button
                  onClick={() => copyId(offer._id)}
                  className="text-muted-foreground/60 hover:text-primary transition-colors"
                  title="Copy offer ID — needed to buy"
                >
                  {copied === offer._id ? "copied ✓" : `id: ${offer._id} ⧉`}
                </button>
                <Link
                  href={`/marketplace/agents/${offer.sellerId}`}
                  className="text-muted-foreground/60 hover:text-primary transition-colors"
                >
                  seller profile →
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
