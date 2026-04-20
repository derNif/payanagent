import { createHash, randomBytes } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { getConvexClient } from "./convex";
import { api } from "@convex/_generated/api";
import { checkRateLimit, getClientIp, RATE_LIMITS } from "./rate-limit";

// Generate a new API key with prefix
export function generateApiKey(): { key: string; hash: string; prefix: string } {
  const random = randomBytes(32).toString("hex");
  const prefix_env = process.env.NODE_ENV === "production" ? "pk_live" : "pk_test";
  const key = `${prefix_env}_${random}`;
  const hash = hashApiKey(key);
  const prefix = key.slice(0, 12);
  return { key, hash, prefix };
}

// Hash an API key with SHA-256
export function hashApiKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

/**
 * Authenticate a request and return the agent, or an error response.
 * Includes rate limiting: 120 req/min per API key, 30 req/min per IP for unauthenticated.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function authenticateRequest(
  request: NextRequest
): Promise<{ agent: any; error?: never } | { agent?: never; error: NextResponse }> {
  const authHeader = request.headers.get("authorization");

  if (!authHeader?.startsWith("Bearer ")) {
    const ip = getClientIp(request);
    const rl = await checkRateLimit(`unauth:${ip}`, RATE_LIMITS.unauthenticated);
    if (!rl.allowed) return { error: tooManyRequestsResponse(rl.resetAt) };
    return { error: unauthorizedResponse() };
  }

  const apiKey = authHeader.slice(7);
  const keyPrefix = apiKey.slice(0, 12);

  // Rate limit by key prefix before DB lookup
  const rl = await checkRateLimit(`key:${keyPrefix}`, RATE_LIMITS.authenticated);
  if (!rl.allowed) return { error: tooManyRequestsResponse(rl.resetAt) };

  const keyHash = hashApiKey(apiKey);
  const convex = getConvexClient();

  const keyRecord = await convex.query(api.apiKeys.getByHash, { keyHash });
  if (!keyRecord || !keyRecord.isActive) {
    return { error: unauthorizedResponse() };
  }

  // Update last used (fire and forget)
  convex.mutation(api.apiKeys.updateLastUsed, { keyId: keyRecord._id });

  const agent = await convex.query(api.agents.getById, {
    agentId: keyRecord.agentId,
  });
  if (!agent || agent.status !== "active") {
    return { error: unauthorizedResponse() };
  }

  return { agent };
}

function unauthorizedResponse() {
  return NextResponse.json(
    { error: "Unauthorized. Provide a valid API key in Authorization: Bearer <key>" },
    { status: 401 }
  );
}

function tooManyRequestsResponse(resetAt: number) {
  return NextResponse.json(
    { error: "Too many requests. Please try again later." },
    {
      status: 429,
      headers: {
        "Retry-After": String(Math.ceil((resetAt - Date.now()) / 1000)),
      },
    }
  );
}

/** @deprecated Use the `error` field from authenticateRequest instead */
export function unauthorizedResponse_legacy() {
  return unauthorizedResponse();
}

export function rateLimitResponse(resetAt: number) {
  return tooManyRequestsResponse(resetAt);
}
