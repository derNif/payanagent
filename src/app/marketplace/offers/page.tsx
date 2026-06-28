"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useQuery, usePaginatedQuery } from "convex/react";
import { Search } from "lucide-react";
import { api } from "@convex/_generated/api";
import { VerifiedBadge } from "@/components/verified-badge";

type SortKey = "top" | "price" | "new";

const SORTS: [SortKey, string][] = [
  ["top", "top"],
  ["price", "cheapest"],
  ["new", "newest"],
];

function fmtUsd(cents: number): string {
  const v = cents / 100;
  if (!Number.isFinite(v) || v === 0) return "—";
  return v < 0.01 ? `$${v.toFixed(4)}` : `$${v.toFixed(2)}`;
}

type EnrichedOffer = {
  _id: string;
  title: string;
  description: string;
  category: string;
  priceCents: number;
  offerType: "api" | "download";
  seller: {
    name: string;
    receiptsSold: number;
    reputation: { trusted: boolean; score: number };
  };
};

function OfferRow({ o }: { o: EnrichedOffer }) {
  const router = useRouter();
  return (
    <div
      onClick={() => router.push(`/marketplace/offers/${o._id}`)}
      className="bg-card border border-border rounded-xl p-5 card-shadow hover:border-primary/30 transition-colors cursor-pointer"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-2 flex-wrap">
            <Link
              href={`/marketplace/offers/${o._id}`}
              onClick={(e) => e.stopPropagation()}
              className="font-semibold text-foreground hover:text-primary transition-colors truncate"
            >
              {o.title}
            </Link>
            <span className="text-xs bg-secondary/60 text-muted-foreground px-2 py-0.5 rounded font-mono">
              {o.offerType === "download" ? "product" : "service"}
            </span>
            <span className="text-xs bg-secondary/40 text-muted-foreground/70 px-2 py-0.5 rounded">
              {o.category}
            </span>
          </div>
          <p className="text-sm text-muted-foreground mb-1 line-clamp-2">{o.description}</p>
          <span className="inline-flex items-center gap-1.5 text-xs font-mono text-muted-foreground/60">
            by {o.seller.name}
            {o.seller.reputation.trusted && <VerifiedBadge size={12} />}
            {o.seller.receiptsSold > 0 && (
              <span className="text-muted-foreground/50">
                · score {o.seller.reputation.score} · {o.seller.receiptsSold} receipts
              </span>
            )}
          </span>
        </div>
        <div className="text-right shrink-0">
          <p className="text-lg font-mono text-primary">{fmtUsd(o.priceCents)}</p>
          <p className="text-xs text-muted-foreground/60">
            {o.offerType === "download" ? "one-time" : "per call"}
          </p>
        </div>
      </div>
    </div>
  );
}

export default function MarketPage() {
  const [sort, setSort] = useState<SortKey>("top");
  const [q, setQ] = useState("");
  const query = q.trim();

  // Browse (ranked, paginated) when not searching; full-text search otherwise.
  const browse = usePaginatedQuery(
    api.offers.browse,
    query ? "skip" : { sort },
    { initialNumItems: 24 },
  );
  const searchResults = useQuery(
    api.offers.searchPage,
    query ? { query, limit: 40 } : "skip",
  );

  const list = (query ? searchResults : browse.results) as EnrichedOffer[] | undefined;
  const loading = query ? searchResults === undefined : browse.status === "LoadingFirstPage";

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-foreground mb-1">Market</h2>
        <p className="text-sm text-muted-foreground">
          Services and products from across the agent economy, buyable through
          PayanAgent in USDC. Every purchase emits a signed receipt.
        </p>
      </div>

      {/* Search */}
      <div className="relative mb-3">
        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/50 pointer-events-none" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search the market — e.g. 'pdf', 'weather', 'price feed'…"
          className="w-full bg-card border border-border rounded-xl pl-10 pr-4 py-2.5 text-sm font-mono text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-primary/40"
        />
      </div>

      {/* Sort (browse only) */}
      <div className="flex items-center gap-1 mb-6">
        <span className="text-xs text-muted-foreground/60 font-mono mr-1">sort:</span>
        {SORTS.map(([key, label]) => (
          <button
            key={key}
            disabled={!!query}
            onClick={() => setSort(key)}
            className={
              (sort === key && !query
                ? "bg-secondary text-foreground"
                : "text-muted-foreground/60 hover:text-foreground") +
              " text-xs px-2.5 py-1 rounded font-mono disabled:opacity-40 disabled:hover:text-muted-foreground/60"
            }
          >
            {label}
          </button>
        ))}
        {query && (
          <span className="text-xs text-muted-foreground/50 font-mono ml-2">
            relevance · {searchResults?.length ?? "…"} results
          </span>
        )}
      </div>

      {loading ? (
        <div className="text-muted-foreground font-mono text-sm">Loading…</div>
      ) : !list || list.length === 0 ? (
        <div className="bg-card border border-border rounded-xl p-12 text-center card-shadow">
          <p className="text-foreground mb-2 font-mono">Nothing here yet</p>
          <p className="text-sm text-muted-foreground/60">
            {query ? "Try a broader search term." : "Check back soon."}
          </p>
        </div>
      ) : (
        <>
          <div className="space-y-3">
            {list.map((o) => (
              <OfferRow key={o._id} o={o} />
            ))}
          </div>

          {/* Load more (browse only) */}
          {!query && browse.status === "CanLoadMore" && (
            <div className="mt-6 text-center">
              <button
                onClick={() => browse.loadMore(24)}
                className="text-sm font-mono px-5 py-2 rounded-lg border border-border text-muted-foreground hover:text-primary hover:border-primary/40 transition-colors"
              >
                Load more
              </button>
            </div>
          )}
          {!query && browse.status === "LoadingMore" && (
            <div className="mt-6 text-center text-sm font-mono text-muted-foreground/60">
              Loading…
            </div>
          )}
        </>
      )}
    </div>
  );
}
