import { ConvexHttpClient } from "convex/browser";
import type { NextResponse } from "next/server";
import { jsonError } from "./api-http";

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL!;

// Shared secret that gates every write/business Convex function. The functions
// are publicly reachable via the Convex URL, so the platform secret — held only
// by this server — is what distinguishes "our authenticated route called this"
// from "a stranger called the mutation directly." Routes pass it on every gated
// call; the Convex handlers reject anything without it.
export const PLATFORM_SECRET = process.env.PLATFORM_INTERNAL_KEY ?? "";

// Server-side Convex client for use in API route handlers
export function getConvexClient() {
  return new ConvexHttpClient(convexUrl);
}

/**
 * Platform secret for the money paths. They fail fast on misconfiguration —
 * never after money has moved — so the check is an explicit gate, not a `!`.
 */
export function requirePlatformSecret():
  | { secret: string; error?: never }
  | { secret?: never; error: NextResponse } {
  if (!PLATFORM_SECRET) {
    return {
      error: jsonError(
        "Platform misconfigured: missing PLATFORM_INTERNAL_KEY",
        500,
      ),
    };
  }
  return { secret: PLATFORM_SECRET };
}
