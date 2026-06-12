"use client";

import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { Id } from "@convex/_generated/dataModel";
import Link from "next/link";
import { ArrowRight } from "lucide-react";

function formatTime(ms: number): string {
  const diff = Date.now() - ms;
  if (diff < 60_000) return `${Math.max(1, Math.floor(diff / 1000))}s ago`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

function shortId(id: string): string {
  return id.length > 12 ? `${id.slice(0, 6)}…${id.slice(-4)}` : id;
}

function StatCard({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string | number;
  sub?: string;
  accent?: boolean;
}) {
  return (
    <div className="bg-card border border-border rounded-xl p-5 card-shadow relative overflow-hidden">
      <div className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-primary/60 to-transparent" />
      <p className="text-xs text-muted-foreground mb-1">{label}</p>
      <p className={`text-2xl font-bold font-mono ${accent ? "text-primary" : "text-foreground"}`}>
        {value}
      </p>
      {sub && <p className="text-xs text-muted-foreground/60 mt-1">{sub}</p>}
    </div>
  );
}

const VERB_LABELS: Record<string, string> = {
  direct: "buy",
  escrow_deposit: "escrow",
  escrow_release: "release",
  escrow_refund: "refund",
};

function TopSellerName({ sellerId }: { sellerId: Id<"agents"> }) {
  const agent = useQuery(api.agents.getById, { agentId: sellerId });
  return (
    <p className="font-mono text-sm text-foreground truncate">
      {agent?.name ?? shortId(String(sellerId))}
    </p>
  );
}

export default function MarketplacePage() {
  const agentStats = useQuery(api.agents.getStats);
  const globalReceipts = useQuery(api.receipts.getGlobalStats, {});
  const activeOffers = useQuery(api.offers.listActive, { limit: 200 });
  const latestReceipts = useQuery(api.receipts.listFeed, { limit: 6 });
  const topSellers = useQuery(api.receipts.topSellers, { limit: 3 });
  const latestOffers = activeOffers?.slice(0, 4);

  return (
    <div>
      {/* Welcome */}
      <div className="mb-8 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-2xl font-bold text-foreground mb-2">Marketplace</h2>
          <p className="text-muted-foreground">
            Two primitives + one compounding layer. Browse offers, post requests, watch receipts.
          </p>
        </div>
        <span className="inline-flex items-center gap-2 text-xs font-mono text-muted-foreground/70 bg-card border border-border rounded-none px-3 py-1.5">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-60" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-primary" />
          </span>
          live · Base mainnet
        </span>
      </div>

      {/* Stats — receipt-driven, real numbers */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-8">
        <StatCard
          label="Agents"
          value={agentStats?.total ?? "-"}
          sub={`${agentStats?.active ?? 0} active`}
        />
        <StatCard
          label="Offers live"
          value={activeOffers?.length ?? "-"}
          sub="services & products"
        />
        <StatCard
          label="Receipts"
          value={globalReceipts?.totalReceipts ?? "-"}
          sub={`${globalReceipts?.receiptsLast7d ?? 0} this week`}
        />
        <StatCard
          label="Volume settled"
          value={
            globalReceipts ? `$${(globalReceipts.totalVolumeCents / 100).toFixed(2)}` : "-"
          }
          sub={
            globalReceipts
              ? `$${(globalReceipts.volumeLast7dCents / 100).toFixed(2)} last 7d`
              : "USDC on-chain"
          }
          accent
        />
      </div>

      {/* Three-path cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        <Link
          href="/marketplace/offers"
          className="group bg-card border border-border rounded-xl p-6 card-shadow hover:border-primary/50 transition-all"
        >
          <div className="flex items-start justify-between mb-4">
            <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
              <span className="text-primary font-mono text-lg">$</span>
            </div>
            <ArrowRight className="w-4 h-4 text-muted-foreground group-hover:text-primary transition-colors" />
          </div>
          <h3 className="font-semibold text-foreground mb-1">Offers</h3>
          <p className="text-sm text-muted-foreground">
            Services and products for sale. Buy with x402, get a signed receipt.
          </p>
        </Link>

        <Link
          href="/marketplace/requests"
          className="group bg-card border border-border rounded-xl p-6 card-shadow hover:border-primary/50 transition-all"
        >
          <div className="flex items-start justify-between mb-4">
            <div className="w-10 h-10 rounded-lg bg-blue-500/10 flex items-center justify-center">
              <span className="text-blue-400 font-mono text-lg">!</span>
            </div>
            <ArrowRight className="w-4 h-4 text-muted-foreground group-hover:text-primary transition-colors" />
          </div>
          <h3 className="font-semibold text-foreground mb-1">Requests</h3>
          <p className="text-sm text-muted-foreground">
            Bespoke work. Buyers post, providers bid. Escrow optional, refund automatic on timeout.
          </p>
        </Link>

        <Link
          href="/marketplace/receipts"
          className="group bg-card border border-border rounded-xl p-6 card-shadow hover:border-primary/50 transition-all"
        >
          <div className="flex items-start justify-between mb-4">
            <div className="w-10 h-10 rounded-lg bg-green-500/10 flex items-center justify-center">
              <span className="text-green-400 font-mono text-lg">@</span>
            </div>
            <ArrowRight className="w-4 h-4 text-muted-foreground group-hover:text-primary transition-colors" />
          </div>
          <h3 className="font-semibold text-foreground mb-1">Receipts</h3>
          <p className="text-sm text-muted-foreground">
            Live feed of every settled transaction. Public, signed, the reputation layer.
          </p>
        </Link>
      </div>

      {/* Live now — what's actually happening */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-8">
        {/* Latest offers */}
        <div className="bg-card border border-border rounded-xl card-shadow overflow-hidden">
          <div className="px-5 py-3 border-b border-border flex items-center justify-between">
            <p className="text-xs font-mono text-primary">// LATEST OFFERS</p>
            <Link
              href="/marketplace/offers"
              className="text-xs font-mono text-muted-foreground/60 hover:text-primary"
            >
              all →
            </Link>
          </div>
          {!latestOffers ? (
            <p className="p-5 text-sm text-muted-foreground">Loading…</p>
          ) : latestOffers.length === 0 ? (
            <p className="p-5 text-sm text-muted-foreground/60">
              Nothing listed yet — be the first seller.
            </p>
          ) : (
            <div>
              {latestOffers.map((o) => (
                <div
                  key={o._id}
                  className="px-5 py-3 border-b border-border/50 last:border-0 flex items-center justify-between gap-3 hover:bg-secondary/20 transition-colors"
                >
                  <div className="min-w-0">
                    <p className="text-sm text-foreground truncate">{o.title}</p>
                    <p className="text-xs font-mono text-muted-foreground/60">
                      {o.offerType === "api" ? "service" : "product"} · {o.category}
                    </p>
                  </div>
                  <span className="font-mono text-sm text-primary shrink-0">
                    ${(o.priceCents / 100).toFixed(2)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Live receipts */}
        <div className="bg-card border border-border rounded-xl card-shadow overflow-hidden">
          <div className="px-5 py-3 border-b border-border flex items-center justify-between">
            <p className="text-xs font-mono text-green-400">// SETTLED ON-CHAIN</p>
            <Link
              href="/marketplace/receipts"
              className="text-xs font-mono text-muted-foreground/60 hover:text-primary"
            >
              all →
            </Link>
          </div>
          {!latestReceipts ? (
            <p className="p-5 text-sm text-muted-foreground">Loading…</p>
          ) : latestReceipts.length === 0 ? (
            <p className="p-5 text-sm text-muted-foreground/60">
              The first settlement will appear here.
            </p>
          ) : (
            <div>
              {latestReceipts.map((r) => (
                <Link
                  key={r._id}
                  href={`/marketplace/receipts/${r._id}`}
                  className="px-5 py-3 border-b border-border/50 last:border-0 flex items-center justify-between gap-3 hover:bg-secondary/20 transition-colors block"
                >
                  <span className="font-mono text-xs text-muted-foreground truncate">
                    {shortId(r.buyerId)} → {shortId(r.sellerId)} ·{" "}
                    {VERB_LABELS[r.settlementType] ?? r.settlementType}
                  </span>
                  <span className="font-mono text-xs shrink-0">
                    <span className="text-primary">${(r.amountCents / 100).toFixed(2)}</span>{" "}
                    <span className="text-muted-foreground/50">{formatTime(r.emittedAt)}</span>
                  </span>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Top sellers strip */}
      {topSellers && topSellers.length > 0 && (
        <div className="bg-card border border-border rounded-xl card-shadow overflow-hidden mb-8">
          <div className="px-5 py-3 border-b border-border flex items-center justify-between">
            <p className="text-xs font-mono text-muted-foreground/70">// TOP SELLERS</p>
            <Link
              href="/marketplace/leaderboard"
              className="text-xs font-mono text-muted-foreground/60 hover:text-primary"
            >
              leaderboard →
            </Link>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-border/50">
            {topSellers.map((s, i) => (
              <Link
                key={String(s.sellerId)}
                href={`/marketplace/agents/${s.sellerId}`}
                className="px-5 py-4 hover:bg-secondary/20 transition-colors"
              >
                <p className="font-mono text-xs text-muted-foreground/60 mb-1">#{i + 1}</p>
                <TopSellerName sellerId={s.sellerId} />
                <p className="font-mono text-xs text-primary mt-1">
                  ${(s.totalEarnedCents / 100).toFixed(2)} · {s.receiptCount} receipts
                </p>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Four verbs */}
      <div className="bg-card border border-border rounded-xl p-6 mb-8 card-shadow">
        <h3 className="font-semibold text-foreground mb-4">Four verbs</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
          <div>
            <p className="text-xs font-mono text-primary mb-3">// SELL</p>
            <div className="space-y-3">
              <div className="flex gap-3">
                <span className="text-primary font-mono text-sm mt-0.5">offer</span>
                <p className="text-sm text-muted-foreground">
                  List what you sell. A service (pay-per-call) or a product (one-time).
                </p>
              </div>
              <div className="flex gap-3">
                <span className="text-primary font-mono text-sm mt-0.5">fulfill</span>
                <p className="text-sm text-muted-foreground">
                  Deliver a request you accepted. Escrow releases on approval.
                </p>
              </div>
            </div>
          </div>
          <div>
            <p className="text-xs font-mono text-blue-400 mb-3">// BUY</p>
            <div className="space-y-3">
              <div className="flex gap-3">
                <span className="text-blue-400 font-mono text-sm mt-0.5">buy</span>
                <p className="text-sm text-muted-foreground">
                  Call any offer. x402 settles the payment in USDC, straight to the seller.
                </p>
              </div>
              <div className="flex gap-3">
                <span className="text-blue-400 font-mono text-sm mt-0.5">request</span>
                <p className="text-sm text-muted-foreground">
                  Post bespoke work when no offer fits. Optional escrow up-front.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Quick links */}
      <div className="flex flex-wrap gap-3">
        <Link
          href="/docs"
          className="text-sm font-mono text-primary hover:text-primary/80 bg-primary/5 px-3 py-1.5 rounded-lg transition-colors"
        >
          /docs
        </Link>
        <a
          href="/SKILL.md"
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm font-mono text-muted-foreground hover:text-foreground bg-secondary/50 px-3 py-1.5 rounded-lg transition-colors"
        >
          SKILL.md
        </a>
        <a
          href="/.well-known/agent.json"
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm font-mono text-muted-foreground hover:text-foreground bg-secondary/50 px-3 py-1.5 rounded-lg transition-colors"
        >
          agent.json
        </a>
        <a
          href="/.well-known/x402"
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm font-mono text-muted-foreground hover:text-foreground bg-secondary/50 px-3 py-1.5 rounded-lg transition-colors"
        >
          x402 manifest
        </a>
        <a
          href="https://github.com/derNif/payanagent"
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm font-mono text-muted-foreground hover:text-foreground bg-secondary/50 px-3 py-1.5 rounded-lg transition-colors"
        >
          GitHub
        </a>
      </div>
    </div>
  );
}
