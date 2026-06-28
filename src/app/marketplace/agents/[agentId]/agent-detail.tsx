"use client";

import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { Id } from "@convex/_generated/dataModel";
import { use, useState } from "react";
import Link from "next/link";
import { VerifiedBadge } from "@/components/verified-badge";

function formatTime(ms: number): string {
  const diff = Date.now() - ms;
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

function shortId(id: string): string {
  return id.length > 12 ? `${id.slice(0, 6)}…${id.slice(-4)}` : id;
}

const TYPE_BADGES: Record<string, string> = {
  agent: "bg-blue-500/10 text-blue-400",
  saas: "bg-purple-500/10 text-purple-400",
  api: "bg-primary/10 text-primary",
};

export default function AgentDetail({
  params,
}: {
  params: Promise<{ agentId: string }>;
}) {
  const { agentId } = use(params);
  const id = agentId as Id<"agents">;
  const agent = useQuery(api.agents.getById, { agentId: id });
  const offers = useQuery(api.offers.listBySeller, { sellerId: id });
  const stats = useQuery(api.receipts.getAgentStats, { agentId: id });
  const reputation = useQuery(api.receipts.getReputation, { agentId: id });
  const receipts = useQuery(api.receipts.listByAgent, {
    agentId: id,
    side: "both",
    limit: 50,
  });
  const [copied, setCopied] = useState<string | null>(null);

  if (!agent) {
    return <div className="text-muted-foreground">Loading...</div>;
  }

  const copy = (label: string, value: string) => {
    navigator.clipboard.writeText(value).then(() => {
      setCopied(label);
      setTimeout(() => setCopied(null), 1500);
    });
  };

  const memberSince = new Date(agent._creationTime).toLocaleDateString("en-US", {
    month: "short",
    year: "numeric",
  });

  return (
    <div className="max-w-4xl mx-auto">
      <Link
        href="/marketplace"
        className="text-sm text-muted-foreground hover:text-foreground mb-4 inline-block font-mono"
      >
        &larr; Back to marketplace
      </Link>

      {/* Identity card */}
      <div className="bg-card border border-border rounded-xl overflow-hidden mb-6 card-shadow">
        <div className="h-1.5 bg-gradient-to-r from-primary via-accent to-primary/40" />
        <div className="p-6">
          <div className="flex items-start gap-4 mb-4 flex-wrap">
            {/* Monogram */}
            <div className="w-14 h-14 rounded-xl bg-secondary/50 border border-border flex items-center justify-center shrink-0">
              <span className="font-mono text-xl text-primary font-bold">
                {agent.name.slice(0, 2).toUpperCase()}
              </span>
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-2xl font-bold text-foreground inline-flex items-center gap-2">
                  {agent.name}
                  {reputation?.trusted && <VerifiedBadge size={20} />}
                </h2>
                <span
                  className={`text-xs px-2 py-0.5 rounded-none font-mono ${
                    TYPE_BADGES[agent.providerType] ?? "bg-secondary"
                  }`}
                >
                  {agent.providerType}
                </span>
                {agent.status === "active" && (
                  <span className="inline-flex items-center gap-1.5 text-xs font-mono text-green-400">
                    <span className="w-1.5 h-1.5 rounded-full bg-green-400" /> active
                  </span>
                )}
              </div>
              <p className="text-xs font-mono text-muted-foreground/60 mt-1">
                on PayanAgent since {memberSince}
              </p>
            </div>
            <button
              onClick={() =>
                copy("profile", `https://payanagent.com/marketplace/agents/${agentId}`)
              }
              className="text-xs font-mono px-3 py-1.5 rounded-lg border border-border text-muted-foreground hover:text-primary hover:border-primary/40 transition-colors shrink-0"
            >
              {copied === "profile" ? "copied ✓" : "share profile"}
            </button>
          </div>

          <p className="text-muted-foreground mb-4">{agent.description}</p>

          {agent.tags.length > 0 && (
            <div className="flex flex-wrap gap-1 mb-6">
              {agent.tags.map((tag) => (
                <span
                  key={tag}
                  className="text-xs bg-secondary text-muted-foreground px-2 py-0.5 rounded"
                >
                  {tag}
                </span>
              ))}
            </div>
          )}

          {/* Derived reputation — the instantly-usable trust signal */}
          {reputation && reputation.sales > 0 && (
            <div className="mb-4 flex items-center gap-4 flex-wrap bg-secondary/30 rounded-lg px-4 py-3 text-sm font-mono">
              <span className="inline-flex items-center gap-1.5 text-foreground">
                {reputation.trusted && <VerifiedBadge size={15} />}
                {reputation.trusted ? "Verified seller" : "Seller"}
              </span>
              <span className="text-muted-foreground">
                trust score <span className="text-foreground/90">{reputation.score}</span>
              </span>
              <span className="text-muted-foreground">
                {Math.round(reputation.successRate * 100)}% delivered
              </span>
              <span className="text-muted-foreground">
                {reputation.distinctBuyers} distinct buyers
              </span>
              <span className="text-muted-foreground">
                {reputation.sales} sales
              </span>
            </div>
          )}

          {/* Receipt-driven stats — the reputation record */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
            <div className="bg-secondary/30 rounded-lg p-3">
              <p className="text-xs text-muted-foreground/60 mb-1">Earned</p>
              <p className="font-mono text-primary text-lg">
                ${((stats?.totalEarnedCents ?? 0) / 100).toFixed(2)}
              </p>
            </div>
            <div className="bg-secondary/30 rounded-lg p-3">
              <p className="text-xs text-muted-foreground/60 mb-1">Spent</p>
              <p className="font-mono text-foreground text-lg">
                ${((stats?.totalSpentCents ?? 0) / 100).toFixed(2)}
              </p>
            </div>
            <div className="bg-secondary/30 rounded-lg p-3">
              <p className="text-xs text-muted-foreground/60 mb-1">Sold</p>
              <p className="font-mono text-foreground text-lg">
                {stats?.receiptsSold ?? 0}
              </p>
            </div>
            <div className="bg-secondary/30 rounded-lg p-3">
              <p className="text-xs text-muted-foreground/60 mb-1">Bought</p>
              <p className="font-mono text-foreground text-lg">
                {stats?.receiptsBought ?? 0}
              </p>
            </div>
          </div>

          <div className="mt-6 pt-4 border-t border-border text-xs text-muted-foreground/60 font-mono space-y-1">
            <p className="flex items-center gap-2 flex-wrap">
              <span>Wallet: {agent.walletAddress}</span>
              <button
                onClick={() => copy("wallet", agent.walletAddress)}
                className="text-muted-foreground/50 hover:text-primary"
              >
                {copied === "wallet" ? "✓" : "⧉"}
              </button>
            </p>
            <p>Chain: {agent.chain}</p>
            {agent.agentUrl && <p>URL: {agent.agentUrl}</p>}
          </div>
        </div>
      </div>

      {/* Offers */}
      <div className="bg-card border border-border rounded-xl p-6 mb-6 card-shadow">
        <h3 className="font-semibold text-foreground mb-4">
          Offers {offers && offers.length > 0 ? `(${offers.length})` : ""}
        </h3>
        {!offers || offers.length === 0 ? (
          <p className="text-sm text-muted-foreground/60">
            No offers listed yet.
          </p>
        ) : (
          <div className="space-y-3">
            {offers.map((offer) => (
              <div
                key={offer._id}
                className="border border-border rounded-lg p-4 flex items-start justify-between gap-3 hover:border-primary/30 transition-colors"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <Link
                      href={`/marketplace/offers/${offer._id}`}
                      className="font-semibold text-foreground hover:text-primary transition-colors"
                    >
                      {offer.title}
                    </Link>
                    <span
                      className={`text-xs px-2 py-0.5 rounded font-mono ${
                        offer.offerType === "api"
                          ? "bg-primary/10 text-primary"
                          : "bg-blue-500/10 text-blue-400"
                      }`}
                    >
                      {offer.offerType === "api" ? "service" : "product"}
                    </span>
                  </div>
                  <p className="text-sm text-muted-foreground line-clamp-2">
                    {offer.description}
                  </p>
                </div>
                <p className="font-mono text-primary shrink-0">
                  ${(offer.priceCents / 100).toFixed(2)}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Receipt history — the reputation layer */}
      <div className="bg-card border border-border rounded-xl p-6 card-shadow">
        <h3 className="font-semibold text-foreground mb-4">
          Receipt history {receipts && receipts.length > 0 ? `(${receipts.length})` : ""}
        </h3>
        {!receipts || receipts.length === 0 ? (
          <p className="text-sm text-muted-foreground/60">
            No receipts yet. Receipts are the public, signed record of every settled
            transaction — this agent&apos;s reputation will build here.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[480px]">
              <thead className="text-xs uppercase text-muted-foreground/70 font-mono">
                <tr>
                  <th className="text-left py-2">When</th>
                  <th className="text-left py-2">Direction</th>
                  <th className="text-left py-2">Counterparty</th>
                  <th className="text-right py-2">Amount</th>
                </tr>
              </thead>
              <tbody>
                {receipts.map((r) => {
                  const isSeller = r.sellerId === agent._id;
                  const counterparty = isSeller ? r.buyerId : r.sellerId;
                  return (
                    <tr
                      key={r._id}
                      className="border-t border-border hover:bg-secondary/20 transition-colors"
                    >
                      <td className="py-2 font-mono text-muted-foreground/80 text-xs">
                        <Link
                          href={`/marketplace/receipts/${r._id}`}
                          className="hover:text-primary"
                        >
                          {formatTime(r.emittedAt)}
                        </Link>
                      </td>
                      <td className="py-2">
                        <span
                          className={`text-xs px-2 py-0.5 rounded font-mono ${
                            isSeller
                              ? "bg-green-500/10 text-green-400"
                              : "bg-secondary text-muted-foreground"
                          }`}
                        >
                          {isSeller ? "earned" : "paid"}
                        </span>
                      </td>
                      <td className="py-2 font-mono text-xs">
                        <Link
                          href={`/marketplace/agents/${counterparty}`}
                          className="text-muted-foreground hover:text-primary"
                        >
                          {shortId(counterparty)}
                        </Link>
                      </td>
                      <td
                        className={`py-2 text-right font-mono ${
                          isSeller ? "text-primary" : "text-foreground"
                        }`}
                      >
                        {isSeller ? "+" : "-"}${(r.amountCents / 100).toFixed(2)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
