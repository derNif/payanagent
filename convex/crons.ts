import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Weekly: refresh the proxied catalog from the Bazaar — adds new sellers and
// patches genuinely-changed offers (the upsert skips no-op writes), so a run is
// mostly reads + a handful of writes. The catalog is slow-moving, so weekly
// keeps it fresh at a fraction of the cost. runStart is stamped in the action.
crons.weekly(
  "refresh catalog",
  { dayOfWeek: "sunday", hourUTC: 7, minuteUTC: 0 },
  internal.ingest.refreshCatalog,
  { offset: 0 },
);

export default crons;
