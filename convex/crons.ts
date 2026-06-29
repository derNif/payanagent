import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Daily: refresh the proxied catalog from the Bazaar (new sellers, price
// changes) and sweep dropped ones. runStart is stamped inside the action.
crons.daily(
  "refresh catalog",
  { hourUTC: 7, minuteUTC: 0 },
  internal.ingest.refreshCatalog,
  { offset: 0 },
);

export default crons;
