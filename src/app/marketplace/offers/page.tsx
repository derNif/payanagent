"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { VerifiedBadge } from "@/components/verified-badge";

type SourceFilter = "all" | "native" | "ecosystem";

// Unified marketplace item — our native offers and mirrored ecosystem resources
// are presented as one catalog (the "whole market through PayanAgent"). The buy
// mechanics differ under the hood (see /x402/:offerId vs /x402/ext/:id); here
// they're one browsable surface, tagged by source.
type Item = {
  kind: "native" | "ecosystem";
  id: string;
  href: string;
  title: string;
  description: string;
  category: string;
  priceUsd: number;
  buyable: boolean;
  // native only
  sellerName?: string;
  sellerId?: string;
  trusted?: boolean;
  score?: number;
  receipts?: number;
  offerType?: "api" | "download";
  // ecosystem only
  network?: string;
};

function fmtUsd(v: number): string {
  if (!Number.isFinite(v) || v === 0) return "—";
  return v < 0.01 ? `$${v.toFixed(4)}` : `$${v.toFixed(2)}`;
}

function netLabel(network: string): string {
  if (network === "eip155:8453" || network === "base") return "Base";
  if (network.startsWith("solana")) return "Solana";
  if (network === "eip155:137") return "Polygon";
  return network;
}

export default function MarketPage() {
  const router = useRouter();
  const [source, setSource] = useState<SourceFilter>("all");
  const [q, setQ] = useState("");
  const query = q.trim();

  const offers = useQuery(
    api.offers.listActiveWithSellers,
    source === "ecosystem" ? "skip" : { limit: 200 },
  );
  const extBrowse = useQuery(
    api.aggregator.listExternal,
    source === "native" || query ? "skip" : { limit: 60 },
  );
  const extSearch = useQuery(
    api.aggregator.searchExternal,
    source !== "native" && query ? { query, limit: 60 } : "skip",
  );
  const ext = query ? extSearch : extBrowse;

  const stats = useQuery(api.aggregator.getExternalStats, {});

  const items: Item[] | undefined = useMemo(() => {
    if (source !== "ecosystem" && offers === undefined) return undefined;
    if (source !== "native" && ext === undefined) return undefined;

    const out: Item[] = [];

    if (source !== "ecosystem" && offers) {
      const ql = query.toLowerCase();
      for (const o of offers) {
        if (
          ql &&
          !o.title.toLowerCase().includes(ql) &&
          !o.description.toLowerCase().includes(ql) &&
          !o.category.toLowerCase().includes(ql)
        )
          continue;
        out.push({
          kind: "native",
          id: o._id,
          href: `/marketplace/offers/${o._id}`,
          title: o.title,
          description: o.description,
          category: o.category,
          priceUsd: o.priceCents / 100,
          buyable: true,
          sellerName: o.seller.name,
          sellerId: String(o.sellerId),
          trusted: o.seller.reputation.trusted,
          score: o.seller.reputation.score,
          receipts: o.seller.receiptsSold,
          offerType: o.offerType,
        });
      }
    }

    if (source !== "native" && ext) {
      for (const r of ext) {
        const base = r.network === "eip155:8453" || r.network === "base";
        out.push({
          kind: "ecosystem",
          id: r._id,
          href: `/marketplace/ext/${r._id}`,
          title: r.serviceName || r.resource,
          description: r.description,
          category: r.category,
          priceUsd: r.priceUsd ?? Number(r.amountRaw) / 1e6,
          buyable: base,
          network: r.network,
        });
      }
    }

    return out;
  }, [offers, ext, source, query]);

  const nativeCount = offers?.length ?? 0;

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-foreground mb-1">Market</h2>
        <p className="text-sm text-muted-foreground">
          The whole x402 market, buyable through PayanAgent in USDC. Native offers
          settle through us; ecosystem resources we relay non-custodially — every
          buy emits a signed receipt.
        </p>
      </div>

      {/* Source tabs + search */}
      <div className="flex items-center justify-between gap-3 flex-wrap mb-5">
        <div className="flex gap-1">
          {(
            [
              ["all", "all"],
              ["native", "native"],
              ["ecosystem", "ecosystem"],
            ] as [SourceFilter, string][]
          ).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setSource(key)}
              className={
                source === key
                  ? "text-xs px-3 py-1 rounded bg-primary text-primary-foreground font-mono"
                  : "text-xs px-3 py-1 rounded bg-secondary text-muted-foreground hover:text-foreground font-mono"
              }
            >
              {label}
            </button>
          ))}
        </div>
        <span className="text-xs text-muted-foreground/60 font-mono">
          {nativeCount} native ·{" "}
          {stats ? `${stats.count.toLocaleString()}${stats.capped ? "+" : ""}` : "…"}{" "}
          ecosystem
        </span>
      </div>

      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search the market — e.g. 'pdf', 'search', 'price'…"
        className="w-full mb-6 bg-card border border-border rounded-xl px-4 py-3 text-sm font-mono text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-primary/40"
      />

      {!items ? (
        <div className="text-muted-foreground font-mono text-sm">Loading…</div>
      ) : items.length === 0 ? (
        <div className="bg-card border border-border rounded-xl p-12 text-center card-shadow">
          <p className="text-foreground mb-2 font-mono">Nothing here yet</p>
          <p className="text-sm text-muted-foreground/60">
            {query ? "Try a broader search term." : "Check back soon."}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((it) => (
            <div
              key={`${it.kind}:${it.id}`}
              onClick={() => router.push(it.href)}
              className="bg-card border border-border rounded-xl p-5 card-shadow hover:border-primary/30 transition-colors cursor-pointer"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-2 flex-wrap">
                    <Link
                      href={it.href}
                      onClick={(e) => e.stopPropagation()}
                      className="font-semibold text-foreground hover:text-primary transition-colors truncate"
                    >
                      {it.title}
                    </Link>
                    {/* source badge */}
                    <span
                      className={`text-[10px] px-1.5 py-0.5 rounded-none font-mono uppercase tracking-wider ${
                        it.kind === "native"
                          ? "bg-primary/10 text-primary"
                          : "bg-secondary text-muted-foreground/70"
                      }`}
                    >
                      {it.kind === "native" ? "native" : "ecosystem"}
                    </span>
                    {it.kind === "ecosystem" && it.network && (
                      <span className="text-xs bg-secondary text-muted-foreground px-2 py-0.5 rounded font-mono">
                        {netLabel(it.network)}
                      </span>
                    )}
                    <span className="text-xs bg-secondary/60 text-muted-foreground px-2 py-0.5 rounded">
                      {it.category}
                    </span>
                  </div>
                  <p className="text-sm text-muted-foreground mb-1 line-clamp-2">
                    {it.description}
                  </p>
                  {it.kind === "native" ? (
                    <Link
                      href={`/marketplace/agents/${it.sellerId}`}
                      onClick={(e) => e.stopPropagation()}
                      className="inline-flex items-center gap-1.5 text-xs font-mono text-muted-foreground/60 hover:text-primary transition-colors"
                    >
                      by {it.sellerName}
                      {it.trusted && <VerifiedBadge size={12} />}
                      {it.receipts ? (
                        <span className="text-muted-foreground/50">
                          · score {it.score} · {it.receipts} receipts
                        </span>
                      ) : null}
                    </Link>
                  ) : (
                    <span className="text-xs font-mono text-muted-foreground/40">
                      via Bazaar {it.buyable ? "" : "· discovery only"}
                    </span>
                  )}
                </div>

                <div className="text-right shrink-0">
                  <p className="text-lg font-mono text-primary">{fmtUsd(it.priceUsd)}</p>
                  <p className="text-xs text-muted-foreground/60">
                    {it.kind === "native"
                      ? it.offerType === "download"
                        ? "one-time"
                        : "per call"
                      : it.buyable
                        ? "per call"
                        : "—"}
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
