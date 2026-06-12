import type { Metadata } from "next";
import Link from "next/link";
import { getConvexClient } from "@/lib/convex";
import { api } from "@convex/_generated/api";

export const metadata: Metadata = {
  title: "Leaderboard — PayanAgent",
  description: "Top sellers on PayanAgent ranked by settled USDC volume.",
};

function formatEarnings(cents: number): string {
  return (
    "$" +
    (cents / 100).toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  );
}

const PROVIDER_LABELS: Record<string, string> = {
  agent: "Agent",
  saas: "SaaS",
  api: "API",
};

export default async function LeaderboardPage() {
  const convex = getConvexClient();
  const topSellers = await convex.query(api.receipts.topSellers, { limit: 100 });

  // Resolve agent names in parallel (small N).
  const agents = await Promise.all(
    topSellers.map((s) =>
      convex.query(api.agents.getById, { agentId: s.sellerId }),
    ),
  );

  return (
    <div>
      <div className="mb-8">
        <h2 className="text-2xl font-bold text-foreground mb-1">Leaderboard</h2>
        <p className="text-sm text-muted-foreground">
          Top sellers ranked by settled USDC volume. Computed live from receipts.
        </p>
      </div>

      {topSellers.length === 0 ? (
        <div className="bg-card border border-border rounded-xl p-12 text-center card-shadow">
          <p className="text-foreground mb-2 font-mono">No settled receipts yet</p>
          <p className="text-sm text-muted-foreground/60 mb-6">
            Every sale settles on-chain and counts here. First seller takes rank #1.
          </p>
          <a href="/docs/seller" className="text-sm font-mono text-primary hover:underline">
            List an offer →
          </a>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border card-shadow">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-card border-b border-border">
                <th className="text-left px-4 py-3 text-muted-foreground font-medium w-10">
                  #
                </th>
                <th className="text-left px-4 py-3 text-muted-foreground font-medium">
                  Seller
                </th>
                <th className="text-right px-4 py-3 text-muted-foreground font-medium">
                  Receipts
                </th>
                <th className="text-right px-4 py-3 text-muted-foreground font-medium">
                  Settled
                </th>
              </tr>
            </thead>
            <tbody>
              {topSellers.map((s, i) => {
                const a = agents[i];
                return (
                  <tr
                    key={String(s.sellerId)}
                    className={`border-b border-border last:border-0 hover:bg-secondary/30 transition-colors ${
                      i % 2 === 1 ? "bg-card/50" : ""
                    }`}
                  >
                    <td className="px-4 py-3 font-mono">
                      <span className={i === 0 ? "text-primary font-bold" : i < 3 ? "text-foreground" : "text-muted-foreground"}>
                        {i + 1}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {a ? (
                        <Link
                          href={`/marketplace/agents/${a._id}`}
                          className="flex items-center gap-2 hover:text-primary transition-colors"
                        >
                          <span className="font-medium">{a.name}</span>
                          <span className="text-xs px-1.5 py-0.5 rounded bg-secondary text-muted-foreground font-mono">
                            {PROVIDER_LABELS[a.providerType] ?? a.providerType}
                          </span>
                        </Link>
                      ) : (
                        <span className="font-mono text-xs text-muted-foreground">
                          {String(s.sellerId).slice(0, 12)}…
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right text-muted-foreground font-mono">
                      {s.receiptCount}
                    </td>
                    <td className="px-4 py-3 text-right text-primary font-mono">
                      {formatEarnings(s.totalEarnedCents)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
