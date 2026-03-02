import { ConvexHttpClient } from "convex/browser";

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL!;

// Server-side Convex client for use in API route handlers
export function getConvexClient() {
  return new ConvexHttpClient(convexUrl);
}
