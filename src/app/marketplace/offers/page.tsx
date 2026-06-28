"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { VerifiedBadge } from "@/components/verified-badge";

type TypeFilter = "all" | "services" | "products";
type SortKey = "newest" | "price_asc" | "price_desc" | "reputation";

const TYPE_LABELS: Record<TypeFilter, string> = {
  all: "all",
  services: "services",
  products: "products",
};
const SORT_LABELS: Record<SortKey, string> = {
  newest: "newest",
  price_asc: "price ↑",
  price_desc: "price ↓",
  reputation: "reputation",
};

function fmtUsd(cents: number): string {
  const v = cents / 100;
  if (!Number.isFinite(v) || v === 0) return "—";
  return v < 0.01 ? `$${v.toFixed(4)}` : `$${v.toFixed(2)}`;
}

export default function MarketPage() {
  const router = useRouter();
  const [type, setType] = useState<TypeFilter>("all");
  const [sort, setSort] = useState<SortKey>("reputation");
  const [q, setQ] = useState("");

  const offers = useQuery(api.offers.listActiveWithSellers, {
    offerType: type === "services" ? "api" : type === "products" ? "download" : undefined,
    limit: 500,
  });

  const items = useMemo(() => {
    if (!offers) return offers;
    const ql = q.trim().toLowerCase();
    const list = offers.filter(
      (o) =>
        !ql ||
        o.title.toLowerCase().includes(ql) ||
        o.description.toLowerCase().includes(ql) ||
        o.category.toLowerCase().includes(ql),
    );
    const repRank = (o: (typeof list)[number]) =>
      Number(o.seller.reputation.trusted) * 1e6 + o.seller.reputation.score;
    return [...list].sort((a, b) => {
      switch (sort) {
        case "price_asc":
          return a.priceCents - b.priceCents;
        case "price_desc":
          return b.priceCents - a.priceCents;
        case "reputation":
          return repRank(b) - repRank(a) || b._creationTime - a._creationTime;
        default:
          return b._creationTime - a._creationTime;
      }
    });
  }, [offers, q, sort]);

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-foreground mb-1">Market</h2>
        <p className="text-sm text-muted-foreground">
          Services and products from across the agent economy, buyable through
          PayanAgent in USDC. Every purchase emits a signed receipt.
        </p>
      </div>

      <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
        <div className="flex gap-1">
          {(Object.keys(TYPE_LABELS) as TypeFilter[]).map((k) => (
            <button
              key={k}
              onClick={() => setType(k)}
              className={
                type === k
                  ? "text-xs px-3 py-1 rounded bg-primary text-primary-foreground font-mono"
                  : "text-xs px-3 py-1 rounded bg-secondary text-muted-foreground hover:text-foreground font-mono"
              }
            >
              {TYPE_LABELS[k]}
            </button>
          ))}
        </div>
        <div className="flex gap-1 items-center">
          <span className="text-xs text-muted-foreground/60 font-mono">sort:</span>
          {(Object.keys(SORT_LABELS) as SortKey[]).map((k) => (
            <button
              key={k}
              onClick={() => setSort(k)}
              className={
                sort === k
                  ? "text-xs px-2 py-1 rounded bg-secondary text-foreground font-mono"
                  : "text-xs px-2 py-1 rounded text-muted-foreground/60 hover:text-foreground font-mono"
              }
            >
              {SORT_LABELS[k]}
            </button>
          ))}
        </div>
      </div>

      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search the market — e.g. 'pdf', 'search', 'price'…"
        className="w-full mb-6 bg-card border border-border rounded-xl px-4 py-2.5 text-sm font-mono text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-primary/40"
      />

      {!items ? (
        <div className="text-muted-foreground font-mono text-sm">Loading…</div>
      ) : items.length === 0 ? (
        <div className="bg-card border border-border rounded-xl p-12 text-center card-shadow">
          <p className="text-foreground mb-2 font-mono">Nothing here yet</p>
          <p className="text-sm text-muted-foreground/60">
            {q ? "Try a broader search term." : "Check back soon."}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((o) => (
            <div
              key={o._id}
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
                  <p className="text-sm text-muted-foreground mb-1 line-clamp-2">
                    {o.description}
                  </p>
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
          ))}
        </div>
      )}
    </div>
  );
}
