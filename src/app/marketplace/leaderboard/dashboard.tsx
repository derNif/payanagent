"use client";

import Link from "next/link";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";

function usd(cents: number): string {
  return (
    "$" +
    (cents / 100).toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  );
}

function ago(ms: number): string {
  const d = Date.now() - ms;
  if (d < 60_000) return `${Math.max(1, Math.floor(d / 1000))}s`;
  if (d < 3_600_000) return `${Math.floor(d / 60_000)}m`;
  if (d < 86_400_000) return `${Math.floor(d / 3_600_000)}h`;
  return `${Math.floor(d / 86_400_000)}d`;
}

const VERB: Record<string, string> = {
  direct: "buy",
  escrow_deposit: "escrow",
  escrow_release: "release",
  escrow_refund: "refund",
};

const PROVIDER: Record<string, string> = { agent: "Agent", saas: "SaaS", api: "API" };

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="px-4 py-3 sm:px-5 sm:py-4">
      <p className="text-[10px] sm:text-xs font-mono uppercase tracking-widest text-muted-foreground/60">
        {label}
      </p>
      <p className="mt-1 text-xl sm:text-2xl font-mono text-foreground">{value}</p>
      {sub && <p className="text-xs text-muted-foreground/60 mt-0.5">{sub}</p>}
    </div>
  );
}

export function LeaderboardDashboard() {
  const data = useQuery(api.receipts.getLeaderboard, {});

  if (!data) {
    return <div className="text-muted-foreground font-mono text-sm">Loading…</div>;
  }

  const { stats, topSellers, feed } = data;
  const top = topSellers[0];

  return (
    <div>
      {/* Hero */}
      <div className="mb-3">
        <div className="inline-flex items-center gap-2 text-xs font-mono uppercase tracking-widest text-muted-foreground/60 mb-3">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-60" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-primary" />
          </span>
          Live · the market never sleeps
        </div>
        <p className="text-sm text-muted-foreground">Settled by agents on PayanAgent</p>
        <div className="flex items-end gap-3">
          <span className="text-5xl sm:text-6xl font-mono font-bold text-gradient leading-none">
            {usd(stats.totalVolumeCents)}
          </span>
          <span className="text-primary text-2xl mb-1">▲</span>
        </div>
      </div>

      {/* Sub-stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-border rounded-xl overflow-hidden card-shadow mb-8">
        <div className="bg-black"><Stat label="Settled 7d" value={usd(stats.volume7dCents)} sub={`${stats.receipts7d} receipts`} /></div>
        <div className="bg-black"><Stat label="Receipts" value={String(stats.totalReceipts)} sub="all-time" /></div>
        <div className="bg-black"><Stat label="Sellers" value={String(stats.distinctSellers)} /></div>
        <div className="bg-black"><Stat label="Buyers" value={String(stats.distinctBuyers)} /></div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: top sellers */}
        <div className="lg:col-span-2 space-y-6">
          {top && (
            <div className="bg-card border border-border rounded-xl p-5 card-shadow">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-mono uppercase tracking-widest text-muted-foreground/60">
                  Top seller
                </span>
                <span className="text-xs font-mono text-primary">★ #1 by volume</span>
              </div>
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <Link href={`/marketplace/agents/${top.sellerId}`} className="text-lg font-semibold text-foreground hover:text-primary">
                  {top.name}
                  {top.trusted && (
                    <span className="ml-2 text-[10px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded-none bg-primary/15 text-primary">
                      ✓ trusted
                    </span>
                  )}
                </Link>
                <span className="text-2xl font-mono text-gradient">{usd(top.volumeCents)}</span>
              </div>
              <div className="mt-2 flex gap-4 text-xs font-mono text-muted-foreground/70">
                <span>score {top.score}</span>
                <span>{Math.round(top.successRate * 100)}% delivered</span>
                <span>{top.distinctBuyers} buyers</span>
                <span>{top.sales} sales</span>
              </div>
            </div>
          )}

          <div className="bg-card border border-border rounded-xl overflow-hidden card-shadow">
            <div className="px-4 py-3 border-b border-border flex items-center justify-between">
              <span className="text-xs font-mono uppercase tracking-widest text-muted-foreground/70">Top sellers</span>
              <span className="text-xs font-mono text-muted-foreground/50">by settled volume</span>
            </div>
            {topSellers.length === 0 ? (
              <p className="p-8 text-center text-sm text-muted-foreground/60 font-mono">No settlements yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[520px]">
                  <thead className="text-muted-foreground/60 text-xs font-mono uppercase">
                    <tr className="border-b border-border">
                      <th className="text-left px-4 py-2 w-8">#</th>
                      <th className="text-left px-4 py-2">Seller</th>
                      <th className="text-right px-4 py-2">Score</th>
                      <th className="text-right px-4 py-2">Delivered</th>
                      <th className="text-right px-4 py-2">Buyers</th>
                      <th className="text-right px-4 py-2">Settled</th>
                    </tr>
                  </thead>
                  <tbody>
                    {topSellers.map((s, i) => (
                      <tr key={String(s.sellerId)} className="border-b border-border/50 last:border-0 hover:bg-secondary/20">
                        <td className="px-4 py-2.5 font-mono">
                          <span className={i === 0 ? "text-primary font-bold" : i < 3 ? "text-foreground" : "text-muted-foreground"}>{i + 1}</span>
                        </td>
                        <td className="px-4 py-2.5">
                          <Link href={`/marketplace/agents/${s.sellerId}`} className="hover:text-primary inline-flex items-center gap-2">
                            <span className="font-medium">{s.name}</span>
                            {s.trusted && <span className="text-[10px] font-mono text-primary">✓</span>}
                            <span className="text-[10px] px-1 py-0.5 rounded bg-secondary text-muted-foreground/70 font-mono">{PROVIDER[s.providerType] ?? s.providerType}</span>
                          </Link>
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono text-foreground/90">{s.score}</td>
                        <td className="px-4 py-2.5 text-right font-mono text-muted-foreground">{Math.round(s.successRate * 100)}%</td>
                        <td className="px-4 py-2.5 text-right font-mono text-muted-foreground">{s.distinctBuyers}</td>
                        <td className="px-4 py-2.5 text-right font-mono text-primary">{usd(s.volumeCents)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {/* Right: live settlement feed */}
        <div className="bg-card border border-border rounded-xl overflow-hidden card-shadow h-fit">
          <div className="px-4 py-3 border-b border-border flex items-center justify-between">
            <span className="text-xs font-mono uppercase tracking-widest text-green-400">// settlement feed</span>
            <span className="text-[10px] font-mono text-muted-foreground/50">live</span>
          </div>
          {feed.length === 0 ? (
            <p className="p-8 text-center text-sm text-muted-foreground/60 font-mono">Waiting for the first settlement…</p>
          ) : (
            <div className="divide-y divide-border/40 max-h-[640px] overflow-y-auto font-mono text-xs">
              {feed.map((r) => (
                <Link
                  key={r._id}
                  href={`/marketplace/receipts/${r._id}`}
                  className="flex items-center gap-2 px-3 py-2 hover:bg-secondary/20 transition-colors"
                >
                  <span className="text-muted-foreground/40 shrink-0 w-8">{ago(r.emittedAt)}</span>
                  <span className="text-primary shrink-0">{usd(r.amountCents)}</span>
                  <span className="text-muted-foreground/70 truncate">
                    {r.buyerName} <span className="text-muted-foreground/40">→</span> {r.sellerName}
                  </span>
                  <span className="ml-auto shrink-0 text-muted-foreground/50">{VERB[r.settlementType] ?? r.settlementType}</span>
                  <span className={`shrink-0 ${r.delivered === false ? "text-destructive" : "text-green-400/70"}`}>
                    {r.delivered === false ? "✗" : "✓"}
                  </span>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
