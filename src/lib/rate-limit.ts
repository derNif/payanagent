/**
 * Rate limiter for API routes. Uses Upstash Redis sliding window when
 * UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN are set; falls back to
 * an in-memory Map for local dev and OSS clones.
 */

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

// ─── Upstash path ────────────────────────────────────────────────────────────

type UpstashRatelimit = {
  limit(identifier: string): Promise<{ success: boolean; remaining: number; reset: number }>;
};

let upstashLimiters: Map<string, UpstashRatelimit> | null = null;
let warnedOnce = false;

function buildUpstashKey(config: RateLimitConfig) {
  return `${config.limit}:${config.windowSeconds}`;
}

async function getUpstashLimiter(config: RateLimitConfig): Promise<UpstashRatelimit | null> {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    if (!warnedOnce) {
      console.warn(
        "[rate-limit] UPSTASH_REDIS_REST_URL or UPSTASH_REDIS_REST_TOKEN is not set — " +
          "falling back to in-memory rate limiting. State will not persist across serverless instances."
      );
      warnedOnce = true;
    }
    return null;
  }

  if (!upstashLimiters) upstashLimiters = new Map();

  const key = buildUpstashKey(config);
  if (!upstashLimiters.has(key)) {
    const { Ratelimit } = await import("@upstash/ratelimit");
    const { Redis } = await import("@upstash/redis");
    const redis = new Redis({ url, token });
    const limiter = new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(config.limit, `${config.windowSeconds} s`),
      prefix: "@payanagent/rl",
    });
    upstashLimiters.set(key, limiter);
  }

  return upstashLimiters.get(key)!;
}

// ─── In-memory fallback ───────────────────────────────────────────────────────

interface MemEntry {
  count: number;
  resetAt: number;
}

const memStore = new Map<string, MemEntry>();

// Cleanup stale entries every 5 minutes (only active in the in-memory path)
setInterval(() => {
  const now = Date.now();
  for (const [k, e] of memStore) {
    if (now > e.resetAt) memStore.delete(k);
  }
}, 5 * 60 * 1000);

function checkMemory(
  key: string,
  config: RateLimitConfig
): { allowed: boolean; remaining: number; resetAt: number } {
  const now = Date.now();
  const entry = memStore.get(key);

  if (!entry || now > entry.resetAt) {
    const resetAt = now + config.windowSeconds * 1000;
    memStore.set(key, { count: 1, resetAt });
    return { allowed: true, remaining: config.limit - 1, resetAt };
  }

  if (entry.count >= config.limit) {
    return { allowed: false, remaining: 0, resetAt: entry.resetAt };
  }

  entry.count++;
  return { allowed: true, remaining: config.limit - entry.count, resetAt: entry.resetAt };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Check and increment rate limit for a key.
 * Returns { allowed, remaining, resetAt }.
 */
export async function checkRateLimit(
  key: string,
  config: RateLimitConfig
): Promise<{ allowed: boolean; remaining: number; resetAt: number }> {
  const limiter = await getUpstashLimiter(config);

  if (limiter) {
    const result = await limiter.limit(key);
    return {
      allowed: result.success,
      remaining: result.remaining,
      resetAt: result.reset,
    };
  }

  return checkMemory(key, config);
}

/**
 * Get the client IP from a request (handles proxies like Vercel).
 */
export function getClientIp(request: Request): string {
  const forwarded = (request.headers.get("x-forwarded-for") || "").split(",")[0].trim();
  const real = request.headers.get("x-real-ip") || "";
  return forwarded || real || "unknown";
}
