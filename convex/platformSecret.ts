// SECURITY: Convex functions are publicly callable, so every mutation/query
// that must only run from our own server routes is gated on this shared secret.
// The check lived (identically) in five modules — one copy means one place to
// audit, and no module can drift into a weaker comparison.
const PLATFORM_INTERNAL_KEY = process.env.PLATFORM_INTERNAL_KEY ?? "";

export function requireSecret(secret: string) {
  if (!PLATFORM_INTERNAL_KEY || secret !== PLATFORM_INTERNAL_KEY) {
    throw new Error("unauthorized: invalid platform secret");
  }
}