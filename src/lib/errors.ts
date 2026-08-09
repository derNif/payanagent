import { NextResponse } from "next/server";

// ─────────────────────────────────────────────────────────────────────────────
// Error handling helpers.
//
// Two rules this file exists to enforce:
//   1. An error that is deliberately not propagated is still logged. A silent
//      catch on a paid path destroys the only evidence that a receipt, a
//      delivery mark or a fee leg was lost.
//   2. A failure of ours is never reported as the caller's fault. Convex
//      surfaces "malformed document id" and "the deployment is unreachable"
//      through the same thrown Error; answering 400 to the latter tells an
//      agent to stop retrying a request that would have succeeded.
// ─────────────────────────────────────────────────────────────────────────────

export function errorMessage(err: unknown, fallback = "unknown error"): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string" && err) return err;
  return fallback;
}

// Structured single-line log for a swallowed or converted error. `scope` is a
// stable "module:operation" key so the line is greppable in the platform logs.
export function logError(
  scope: string,
  err: unknown,
  context?: Record<string, unknown>,
): void {
  const cause = err instanceof Error && err.cause ? errorMessage(err.cause) : undefined;
  console.error(
    `[${scope}] ${errorMessage(err)}`,
    JSON.stringify({ ...context, ...(cause ? { cause } : {}) }),
  );
}

// A rejection handler for work whose failure must not fail the request —
// post-settlement bookkeeping, page-level enrichment. Logs, then resolves null.
//   await mark(true).catch(swallow("x402.buy:markDelivered", { receiptId }))
export function swallow(
  scope: string,
  context?: Record<string, unknown>,
): (err: unknown) => null {
  return (err: unknown) => {
    logError(scope, err, context);
    return null;
  };
}

const NETWORK_ERROR_PATTERNS = [
  "fetch failed",
  "failed to fetch",
  "econnrefused",
  "econnreset",
  "enotfound",
  "etimedout",
  "epipe",
  "socket hang up",
  "getaddrinfo",
  "network error",
  "request timed out",
];

// True when the error looks like "we could not talk to the dependency" rather
// than "the caller sent something invalid". `fetch` rejects with a TypeError on
// every transport failure, which is how the Convex HTTP client reports an
// unreachable deployment.
export function isUpstreamUnavailable(err: unknown): boolean {
  if (err instanceof TypeError) return true;
  const message = errorMessage(err).toLowerCase();
  return NETWORK_ERROR_PATTERNS.some((pattern) => message.includes(pattern));
}

// Retryable "this one is on us" answer, so a caller backs off instead of
// treating a dependency outage as a permanently bad request.
export function upstreamUnavailableResponse(): NextResponse {
  return NextResponse.json(
    { error: "Upstream data store unavailable, retry shortly" },
    { status: 503, headers: { "Retry-After": "2" } },
  );
}

// Catch-all response for a read that failed for reasons the caller cannot fix.
// The cause goes to the logs, not to the client: the raw text of a Convex or
// driver error is an internal detail, and returning it as `error` both leaks
// implementation and hides that this was a 5xx of ours.
export function internalErrorResponse(
  scope: string,
  err: unknown,
  context?: Record<string, unknown>,
): NextResponse {
  logError(scope, err, context);
  if (isUpstreamUnavailable(err)) return upstreamUnavailableResponse();
  return NextResponse.json({ error: "Internal server error" }, { status: 500 });
}

// Response for a failed document lookup by id. A malformed id is the caller's
// 400; an unreachable Convex deployment is our 503 (retryable, and logged).
export function lookupErrorResponse(
  scope: string,
  err: unknown,
  invalidIdError: string,
  context?: Record<string, unknown>,
): NextResponse {
  logError(scope, err, context);
  if (isUpstreamUnavailable(err)) return upstreamUnavailableResponse();
  return NextResponse.json({ error: invalidIdError }, { status: 400 });
}
