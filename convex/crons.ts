import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Daily escrow timeout sweep — auto-refund `accepted` jobs past the 14-day
// window. See convex/timeouts.ts for details.
crons.daily(
  "escrow timeout sweep",
  { hourUTC: 3, minuteUTC: 0 },
  internal.timeouts.sweep
);

export default crons;
