import Link from "next/link";
import { fetchQuery } from "convex/nextjs";
import { api } from "@convex/_generated/api";
import { Doc } from "@convex/_generated/dataModel";

// Server component. Access is gated by middleware (ADMIN_KEY). Agent rows —
// which include PII (ownerEmail) and discoverySource — are read via the
// platform-secret-gated agents.listAdmin query, never the public agents.list.
export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const platformSecret = process.env.PLATFORM_INTERNAL_KEY || "";

  const [agentStats, globalReceipts] = await Promise.all([
    fetchQuery(api.agents.getStats, {}),
    fetchQuery(api.receipts.getGlobalStats, {}),
  ]);

  let agents: Doc<"agents">[] = [];
  let agentsError: string | null = null;
  if (!platformSecret) {
    agentsError = "PLATFORM_INTERNAL_KEY is not configured.";
  } else {
    try {
      agents = await fetchQuery(api.agents.listAdmin, { platformSecret });
    } catch {
      agentsError = "Failed to load agents.";
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold mb-2">Admin</h1>
            <p className="text-muted-foreground">Live overview from agents + receipts.</p>
          </div>
          <Link href="/marketplace" className="text-sm text-muted-foreground hover:text-foreground">
            ← marketplace
          </Link>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
          <div className="bg-card border border-border rounded-xl p-5">
            <p className="text-xs text-muted-foreground/60 mb-1">Agents</p>
            <p className="text-2xl font-mono">{agentStats.total}</p>
            <p className="text-xs text-muted-foreground/60 mt-1">{agentStats.active} active</p>
          </div>
          <div className="bg-card border border-border rounded-xl p-5">
            <p className="text-xs text-muted-foreground/60 mb-1">Receipts</p>
            <p className="text-2xl font-mono">{globalReceipts.totalReceipts}</p>
            <p className="text-xs text-muted-foreground/60 mt-1">
              {globalReceipts.receiptsLast7d} this week
            </p>
          </div>
          <div className="bg-card border border-border rounded-xl p-5">
            <p className="text-xs text-muted-foreground/60 mb-1">Total volume</p>
            <p className="text-2xl font-mono text-primary">
              ${(globalReceipts.totalVolumeCents / 100).toFixed(2)}
            </p>
            <p className="text-xs text-muted-foreground/60 mt-1">USDC settled</p>
          </div>
          <div className="bg-card border border-border rounded-xl p-5">
            <p className="text-xs text-muted-foreground/60 mb-1">7d volume</p>
            <p className="text-2xl font-mono text-primary">
              ${(globalReceipts.volumeLast7dCents / 100).toFixed(2)}
            </p>
          </div>
        </div>

        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-border flex items-center justify-between">
            <h3 className="font-semibold">All agents ({agents.length})</h3>
          </div>
          {agentsError ? (
            <p className="p-4 text-sm text-muted-foreground">{agentsError}</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-secondary/30 text-muted-foreground/70 text-xs uppercase font-mono">
                <tr>
                  <th className="px-4 py-2 text-left">Name</th>
                  <th className="px-4 py-2 text-left">Type</th>
                  <th className="px-4 py-2 text-left">Wallet</th>
                  <th className="px-4 py-2 text-left">Source</th>
                  <th className="px-4 py-2 text-left">Status</th>
                </tr>
              </thead>
              <tbody>
                {agents.map((a) => (
                  <tr key={a._id} className="border-t border-border hover:bg-secondary/20">
                    <td className="px-4 py-2">
                      <Link
                        href={`/marketplace/agents/${a._id}`}
                        className="text-primary hover:underline"
                      >
                        {a.name}
                      </Link>
                    </td>
                    <td className="px-4 py-2 text-muted-foreground">{a.providerType}</td>
                    <td className="px-4 py-2 font-mono text-xs text-muted-foreground/70">
                      {a.walletAddress.slice(0, 8)}…{a.walletAddress.slice(-4)}
                    </td>
                    <td
                      className="px-4 py-2 text-xs text-muted-foreground/70 max-w-[200px] truncate"
                      title={a.discoverySource}
                    >
                      {a.discoverySource || "—"}
                    </td>
                    <td className="px-4 py-2">
                      <span
                        className={`text-xs px-2 py-0.5 rounded-none ${
                          a.status === "active"
                            ? "bg-primary/10 text-primary"
                            : a.status === "suspended"
                              ? "bg-yellow-500/10 text-yellow-400"
                              : "bg-muted text-muted-foreground"
                        }`}
                      >
                        {a.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
