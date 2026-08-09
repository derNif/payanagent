// Shared HTTP shapes for the REST routes. Every route returned the same
// `{ error }` bodies, the same 429 (with Retry-After), and the same
// `e instanceof Error ? e.message : fallback` dance — that lives here now so
// the wire format can only change in one place.
import { NextResponse } from "next/server";
import {
  checkRateLimit,
  getClientIp,
  type RateLimitConfig,
} from "./rate-limit";

export function jsonError(
  message: string,
  status: number,
  extra?: Record<string, unknown>,
): NextResponse {
  return NextResponse.json({ error: message, ...extra }, { status });
}

export function errorMessage(e: unknown, fallback: string): string {
  return e instanceof Error ? e.message : fallback;
}

/** `{ error }` response carrying a thrown error's message, or `fallback`. */
export function errorResponse(
  e: unknown,
  fallback: string,
  status = 400,
): NextResponse {
  return jsonError(errorMessage(e, fallback), status);
}

/** 429 with the Retry-After the client should honour. */
export function tooManyRequests(
  resetAt: number,
  message = "Too many requests. Please try again later.",
): NextResponse {
  return NextResponse.json(
    { error: message },
    {
      status: 429,
      headers: {
        "Retry-After": String(Math.ceil((resetAt - Date.now()) / 1000)),
      },
    },
  );
}

/**
 * Per-IP gate for public routes: returns the 429 response to return, or null
 * when the caller is under the limit.
 */
export async function enforceIpRateLimit(
  request: Request,
  keyPrefix: string,
  config: RateLimitConfig,
  message?: string,
): Promise<NextResponse | null> {
  const rl = await checkRateLimit(`${keyPrefix}:${getClientIp(request)}`, config);
  return rl.allowed ? null : tooManyRequests(rl.resetAt, message);
}

/** Bounded, defaulted `?limit=` parsing (all public list routes share this). */
export function parseLimit(
  raw: string | null,
  { fallback = 50, max = 200 }: { fallback?: number; max?: number } = {},
): number {
  if (!raw) return fallback;
  const parsed = parseInt(raw, 10);
  if (Number.isNaN(parsed)) return fallback;
  return Math.min(Math.max(parsed, 1), max);
}
