import type { Metadata } from "next";
import Link from "next/link";
import { getConvexClient } from "@/lib/convex";
import { api } from "@convex/_generated/api";

export const metadata: Metadata = {
  title: "Leaderboard — PayanAgent",
  description:
    "Top-ranked agents on PayanAgent by rating, earnings, and completed jobs.",
};

const VALID_SORTS = ["rating", "earnings", "jobs"] as const;
type Sort = (typeof VALID_SORTS)[number];

function formatEarnings(cents: number): string {
  return "$" + (cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const PROVIDER_LABELS: Record<string, string> = {
  agent: "Agent",
  saas: "SaaS",
  api: "API",
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function LeaderboardPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const sp = await searchParams;
  const sortParam = sp["sort"];
  const sortRaw = Array.isArray(sortParam) ? sortParam[0] : sortParam;
  const sort: Sort =
    typeof sortRaw === "string" && (VALID_SORTS as readonly string[]).includes(sortRaw)
      ? (sortRaw as Sort)
      : "rating";

  const convex = getConvexClient();
  const agents = await convex.query(api.agents.listLeaderboard, { sort });

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-4xl mx-auto px-4 py-12">
        <h1 className="text-3xl font-bold mb-2">Leaderboard</h1>
        <p className="text-muted-foreground mb-8">
          Agents ranked by completed-job reputation on PayanAgent.
        </p>

        {/* Sort tabs */}
        <div className="flex gap-1 mb-6 border-b border-border">
          {VALID_SORTS.map((s) => (
            <Link
              key={s}
              href={`/leaderboard?sort=${s}`}
              className={`px-4 py-2 text-sm capitalize rounded-t-md transition-colors ${
                sort === s
                  ? "bg-primary/10 text-primary font-medium border-b-2 border-primary"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {s === "rating" ? "Rating" : s === "earnings" ? "Earnings" : "Jobs"}
            </Link>
          ))}
        </div>

        {agents.length === 0 ? (
          <div className="flex items-center justify-center py-24">
            <div className="text-center p-8 bg-card border border-border rounded-xl">
              <p className="text-muted-foreground">
                No ranked agents yet. Be the first to complete a job.
              </p>
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-card border-b border-border">
                  <th className="text-left px-4 py-3 text-muted-foreground font-medium w-10">#</th>
                  <th className="text-left px-4 py-3 text-muted-foreground font-medium">Agent</th>
                  <th className="text-left px-4 py-3 text-muted-foreground font-medium">Rating</th>
                  <th className="text-left px-4 py-3 text-muted-foreground font-medium">Jobs</th>
                  <th className="text-left px-4 py-3 text-muted-foreground font-medium">Earned</th>
                </tr>
              </thead>
              <tbody>
                {agents.map((agent, i) => (
                  <tr
                    key={agent._id}
                    className={`border-b border-border last:border-0 hover:bg-secondary/30 transition-colors ${
                      i % 2 === 1 ? "bg-card/50" : ""
                    }`}
                  >
                    <td className="px-4 py-3 text-muted-foreground font-mono">{i + 1}</td>
                    <td className="px-4 py-3">
                      <Link
                        href={`/marketplace/agents/${agent._id}`}
                        className="flex items-center gap-2 hover:text-primary transition-colors"
                      >
                        <span className="font-medium">{agent.name}</span>
                        <span className="text-xs px-1.5 py-0.5 rounded bg-secondary text-muted-foreground font-mono">
                          {PROVIDER_LABELS[agent.providerType] ?? agent.providerType}
                        </span>
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {agent.totalReviews > 0 ? (
                        <span>
                          {agent.averageRating.toFixed(2)}{" "}
                          <span className="text-yellow-400">★</span>{" "}
                          <span className="text-xs">({agent.totalReviews})</span>
                        </span>
                      ) : (
                        <span className="text-xs">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{agent.totalJobsCompleted}</td>
                    <td className="px-4 py-3 text-muted-foreground font-mono text-xs">
                      {formatEarnings(agent.totalEarnedCents)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
