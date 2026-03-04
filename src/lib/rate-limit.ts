/**
 * Simple in-memory rate limiter for API routes.
 *
 * Uses a sliding window counter per key (IP or API key prefix).
 * Entries auto-expire to prevent memory leaks.
 */

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const store = new Map<string, RateLimitEntry>();

// Cleanup stale entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of store) {
    if (now > entry.resetAt) store.delete(key);
  }
}, 5 * 60 * 1000);

export interface RateLimitConfig {
  /** Max requests allowed in the window */
  limit: number;
  /** Window duration in seconds */
  windowSeconds: number;
}

/** Predefined rate limit tiers */
export const RATE_LIMITS = {
  /** Agent registration: 5 per hour per IP */
  registration: { limit: 5, windowSeconds: 3600 },
  /** Authenticated API calls: 120 per minute per API key */
  authenticated: { limit: 120, windowSeconds: 60 },
  /** Unauthenticated requests: 30 per minute per IP */
  unauthenticated: { limit: 30, windowSeconds: 60 },
  /** Service invoke (paid): 60 per minute per API key */
  invoke: { limit: 60, windowSeconds: 60 },
} as const;

/**
 * Check and increment rate limit for a key.
 * Returns { allowed, remaining, resetAt } or { allowed: false } if over limit.
 */
export function checkRateLimit(
  key: string,
  config: RateLimitConfig
): { allowed: boolean; remaining: number; resetAt: number } {
  const now = Date.now();
  const entry = store.get(key);

  if (!entry || now > entry.resetAt) {
    // New window
    store.set(key, { count: 1, resetAt: now + config.windowSeconds * 1000 });
    return { allowed: true, remaining: config.limit - 1, resetAt: now + config.windowSeconds * 1000 };
  }

  if (entry.count >= config.limit) {
    return { allowed: false, remaining: 0, resetAt: entry.resetAt };
  }

  entry.count++;
  return { allowed: true, remaining: config.limit - entry.count, resetAt: entry.resetAt };
}

/**
 * Get the client IP from a request (handles proxies like Vercel).
 */
export function getClientIp(request: Request): string {
  const forwarded = (request.headers.get("x-forwarded-for") || "").split(",")[0].trim();
  const real = request.headers.get("x-real-ip") || "";
  return forwarded || real || "unknown";
}
