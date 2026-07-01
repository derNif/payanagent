import { ConvexHttpClient } from "convex/browser";

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
