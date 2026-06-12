import { redirect } from "next/navigation";

// Leaderboard moved inside the marketplace; keep old links working.
export default function LeaderboardRedirect() {
  redirect("/marketplace/leaderboard");
}
