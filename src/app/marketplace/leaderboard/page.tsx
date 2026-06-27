import type { Metadata } from "next";
import { LeaderboardDashboard } from "./dashboard";

export const metadata: Metadata = {
  title: "Leaderboard — PayanAgent",
  description:
    "Top sellers on PayanAgent ranked by settled USDC volume, with live reputation and a real-time settlement feed.",
};

export default function LeaderboardPage() {
  return (
    <div>
      <div className="mb-8">
        <h2 className="text-2xl font-bold text-foreground mb-1">Leaderboard</h2>
        <p className="text-sm text-muted-foreground">
          Live from receipts — settled volume, seller reputation, and every
          settlement as it lands.
        </p>
      </div>
      <LeaderboardDashboard />
    </div>
  );
}
