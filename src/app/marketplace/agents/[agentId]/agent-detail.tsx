"use client";

import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { Id } from "@convex/_generated/dataModel";
import { use } from "react";
import Link from "next/link";

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

const TYPE_COLORS: Record<string, string> = {
  direct: "bg-primary/10 text-primary",
  escrow_deposit: "bg-blue-500/10 text-blue-400",
  escrow_release: "bg-green-500/10 text-green-400",
  escrow_refund: "bg-yellow-500/10 text-yellow-400",
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
  const receipts = useQuery(api.receipts.listByAgent, {
    agentId: id,
    side: "both",
    limit: 50,
  });

  if (!agent) {
    return <div className="text-muted-foreground">Loading...</div>;
  }

  return (
    <div>
      <Link
        href="/marketplace"
        className="text-sm text-muted-foreground hover:text-foreground mb-4 inline-block"
      >
        &larr; Back to marketplace
      </Link>

      <div className="bg-card border border-border rounded-xl p-6 mb-6">
        <div className="flex items-start justify-between mb-4 gap-3 flex-wrap">
          <div className="min-w-0">
            <h2 className="text-2xl font-bold text-foreground">{agent.name}</h2>
            <span
              className={`text-xs px-2 py-0.5 rounded-full font-mono ${
                agent.providerType === "agent"
                  ? "bg-blue-500/10 text-blue-400"
                  : agent.providerType === "saas"
                    ? "bg-purple-500/10 text-purple-400"
                    : "bg-primary/10 text-primary"
              }`}
            >
              {agent.providerType}
            </span>
          </div>
        </div>

        <p className="text-muted-foreground mb-4">{agent.description}</p>

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

        {/* Receipt-driven stats — replaces v1 denormalized counters */}
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

        <div className="mt-6 pt-4 border-t border-border text-xs text-muted-foreground/60 font-mono">
          <p>Wallet: {agent.walletAddress}</p>
          <p>Chain: {agent.chain}</p>
          {agent.agentUrl && <p>URL: {agent.agentUrl}</p>}
        </div>
      </div>

      {/* Offers */}
      {offers && offers.length > 0 && (
        <div className="bg-card border border-border rounded-xl p-6 mb-6">
          <h3 className="font-semibold text-foreground mb-4">
            Offers ({offers.length})
          </h3>
          <div className="space-y-3">
            {offers.map((offer) => (
              <div
                key={offer._id}
                className="border border-border rounded-lg p-4 flex items-start justify-between gap-3"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <p className="font-semibold text-foreground">{offer.title}</p>
                    <span
                      className={`text-xs px-2 py-0.5 rounded font-mono ${
                        offer.offerType === "api"
                          ? "bg-primary/10 text-primary"
                          : "bg-blue-500/10 text-blue-400"
                      }`}
                    >
                      {offer.offerType}
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
        </div>
      )}

      {/* Receipt history — the reputation layer */}
      {receipts && receipts.length > 0 && (
        <div className="bg-card border border-border rounded-xl p-6">
          <h3 className="font-semibold text-foreground mb-4">
            Receipt history ({receipts.length})
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs uppercase text-muted-foreground/70 font-mono">
                <tr>
                  <th className="text-left py-2">When</th>
                  <th className="text-left py-2">Type</th>
                  <th className="text-left py-2">Counterparty</th>
                  <th className="text-right py-2">Amount</th>
                </tr>
              </thead>
              <tbody>
                {receipts.map((r) => {
                  const isSeller = r.sellerId === agent._id;
                  const counterparty = isSeller ? r.buyerId : r.sellerId;
                  return (
                    <tr key={r._id} className="border-t border-border">
                      <td className="py-2 font-mono text-muted-foreground/80 text-xs">
                        {formatTime(r.emittedAt)}
                      </td>
                      <td className="py-2">
                        <span
                          className={`text-xs px-2 py-0.5 rounded font-mono ${
                            TYPE_COLORS[r.settlementType] ?? "bg-secondary"
                          }`}
                        >
                          {isSeller ? "→ in" : "← out"}
                        </span>
                      </td>
                      <td className="py-2 font-mono text-xs text-muted-foreground">
                        {shortId(counterparty)}
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
        </div>
      )}
    </div>
  );
}
