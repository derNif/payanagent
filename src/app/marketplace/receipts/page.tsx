"use client";

import { useRouter } from "next/navigation";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";

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

export default function ReceiptsPage() {
  const router = useRouter();
  const receipts = useQuery(api.receipts.listFeed, { limit: 100 });
  const stats = useQuery(api.receipts.getGlobalStats, {});

  return (
    <div>
      <div className="mb-6 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-2xl font-bold text-foreground mb-2">Receipts</h2>
          <p className="text-sm text-muted-foreground">
            Live feed of settled transactions across the marketplace. Public, signed, verifiable.
          </p>
        </div>
        <span className="inline-flex items-center gap-2 text-xs font-mono text-muted-foreground/70 bg-card border border-border rounded-full px-3 py-1.5">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-60" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-primary" />
          </span>
          live
        </span>
      </div>

      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          <div className="bg-card border border-border rounded-xl p-4 card-shadow">
            <p className="text-xs text-muted-foreground/60 mb-1">Total receipts</p>
            <p className="text-xl font-mono text-foreground">{stats.totalReceipts}</p>
          </div>
          <div className="bg-card border border-border rounded-xl p-4 card-shadow">
            <p className="text-xs text-muted-foreground/60 mb-1">Total volume</p>
            <p className="text-xl font-mono text-primary">
              ${(stats.totalVolumeCents / 100).toFixed(2)}
            </p>
          </div>
          <div className="bg-card border border-border rounded-xl p-4 card-shadow">
            <p className="text-xs text-muted-foreground/60 mb-1">Last 7d</p>
            <p className="text-xl font-mono text-foreground">{stats.receiptsLast7d}</p>
          </div>
          <div className="bg-card border border-border rounded-xl p-4 card-shadow">
            <p className="text-xs text-muted-foreground/60 mb-1">7d volume</p>
            <p className="text-xl font-mono text-primary">
              ${(stats.volumeLast7dCents / 100).toFixed(2)}
            </p>
          </div>
        </div>
      )}

      {!receipts ? (
        <div className="text-muted-foreground">Loading...</div>
      ) : receipts.length === 0 ? (
        <div className="bg-card border border-border rounded-xl p-12 text-center card-shadow">
          <p className="text-foreground mb-2 font-mono">No receipts yet</p>
          <p className="text-sm text-muted-foreground/60 mb-6">
            Every settled transaction emits a public, signed receipt. The first one will appear
            here the moment it happens.
          </p>
          <a
            href="/docs"
            className="inline-block text-sm font-mono text-primary hover:underline"
          >
            Make the first one →
          </a>
        </div>
      ) : (
        <div className="bg-card border border-border rounded-xl overflow-hidden card-shadow">
          <table className="w-full text-sm">
            <thead className="bg-secondary/30 text-muted-foreground/70 text-xs uppercase font-mono">
              <tr>
                <th className="px-4 py-2 text-left">When</th>
                <th className="px-4 py-2 text-left">Type</th>
                <th className="px-4 py-2 text-left">Buyer → Seller</th>
                <th className="px-4 py-2 text-right">Amount</th>
                <th className="px-4 py-2 text-left">Tx</th>
              </tr>
            </thead>
            <tbody>
              {receipts.map((r) => (
                <tr
                  key={r._id}
                  onClick={() => router.push(`/marketplace/receipts/${r._id}`)}
                  className="border-t border-border hover:bg-secondary/20 cursor-pointer transition-colors"
                >
                  <td className="px-4 py-2 font-mono text-muted-foreground/80">
                    {formatTime(r.emittedAt)}
                  </td>
                  <td className="px-4 py-2">
                    <span
                      className={`text-xs px-2 py-0.5 rounded font-mono ${
                        TYPE_COLORS[r.settlementType] || "bg-secondary"
                      }`}
                    >
                      {r.settlementType}
                    </span>
                  </td>
                  <td className="px-4 py-2 font-mono text-xs text-foreground/80">
                    {shortId(r.buyerId)} → {shortId(r.sellerId)}
                  </td>
                  <td className="px-4 py-2 text-right font-mono text-primary">
                    ${(r.amountCents / 100).toFixed(2)}
                  </td>
                  <td className="px-4 py-2 font-mono text-xs">
                    {r.txHash ? (
                      <a
                        href={`https://basescan.org/tx/${r.txHash}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="text-muted-foreground/60 hover:text-primary"
                      >
                        {shortId(r.txHash)} ↗
                      </a>
                    ) : (
                      <span className="text-muted-foreground/40">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
