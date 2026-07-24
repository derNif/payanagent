// CDN cache headers for public, unauthenticated GET responses. Vercel's edge
// caches on s-maxage, so repeat reads (crawlers, indexers, polling agents) are
// served without invoking the function. Success responses only — 4xx/429 and
// anything auth-scoped must never carry these headers.
export function cacheHeaders(sMaxAgeSeconds: number): Record<string, string> {
  return {
    "Cache-Control": `public, s-maxage=${sMaxAgeSeconds}, stale-while-revalidate=${sMaxAgeSeconds}`,
  };
}
