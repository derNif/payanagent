// Shared tuning knobs.
//
// These are intentionally hard-coded constants (not env vars) so behavior is
// identical across dev and prod; tune by shipping a new build.

// Days an `accepted` job can sit without transitioning to `delivered` before
// the escrow is auto-refunded to the client. See convex/timeouts.ts.
export const JOB_ACCEPT_TIMEOUT_DAYS = 14;
export const JOB_ACCEPT_TIMEOUT_MS = JOB_ACCEPT_TIMEOUT_DAYS * 24 * 60 * 60 * 1000;
