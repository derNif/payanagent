import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal, api } from "./_generated/api";

// Keeps the proxied catalog fresh: re-ingests the CDP Bazaar discovery API
// (new sellers, price changes, refreshed lastSeenAt) in self-rescheduling chunks
// so each action stays within limits, then sweeps offers not seen this run.
// Scheduled daily by convex/crons.ts. Mirrors scripts/ingest-bazaar.mjs mapping.

const DISCOVERY =
  "https://api.cdp.coinbase.com/platform/v2/x402/discovery/resources";
const BASE_NETWORKS = new Set(["eip155:8453", "base"]);
const USDC: Record<string, number> = {
  "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913": 6, // Base mainnet
  "0x036cbd53842c5426634e7929541ec2318f3dcf7e": 6, // Base sepolia
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function pickAccept(accepts: any[]) {
  if (!Array.isArray(accepts) || accepts.length === 0) return null;
  const base = accepts.filter(
    (a) => a.network === "eip155:8453" && a.scheme === "exact",
  );
  const usdcPlain = base.find(
    (a) => USDC[String(a.asset).toLowerCase()] && !a.extra?.assetTransferMethod,
  );
  return usdcPlain || base[0] || accepts[0];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function priceUsd(accept: any): number | undefined {
  const dec = USDC[String(accept.asset).toLowerCase()];
  if (!dec) return undefined;
  const n = Number(accept.amount);
  return Number.isFinite(n) ? n / 10 ** dec : undefined;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function qualityScore(q: any): number | undefined {
  if (typeof q === "number") return q;
  if (q && typeof q === "object" && typeof q.score === "number") return q.score;
  return undefined;
}

const S = (o: unknown) => (o == null ? undefined : JSON.stringify(o));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapItem(item: any) {
  if (!item?.resource) return null;
  const accept = pickAccept(item.accepts);
  if (!accept?.payTo || !accept?.asset || !accept?.network) return null;
  if (!BASE_NETWORKS.has(accept.network)) return null; // Base only
  const tags = Array.isArray(item.tags) ? item.tags.slice(0, 12) : [];
  const usd = priceUsd(accept);
  const name = item.serviceName ? String(item.serviceName).slice(0, 200) : undefined;
  return {
    externalUrl: String(item.resource),
    sellerName: name,
    title: (name || String(item.resource)).slice(0, 200),
    description: String(item.description || item.serviceName || item.resource).slice(0, 2000),
    category: (tags[0] || "Other").slice(0, 60),
    tags,
    priceCents: usd != null ? Math.round(usd * 100) : 0,
    amountRaw: String(accept.amount ?? "0"),
    asset: String(accept.asset),
    network: String(accept.network),
    payTo: String(accept.payTo),
    inputSchema: S(item.extensions?.bazaar?.info?.input),
    outputSchema: S(item.extensions?.bazaar?.info?.output),
    qualityScore: qualityScore(item.quality),
    sourceLastUpdated: item.lastUpdated ? String(item.lastUpdated) : undefined,
  };
}

export const refreshCatalog = internalAction({
  args: { offset: v.number(), runStart: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const platformSecret = process.env.PLATFORM_INTERNAL_KEY ?? "";
    if (!platformSecret) return;
    const runStart = args.runStart ?? Date.now();
    const PAGE = 100;
    const CHUNK = 20; // pages per invocation (keeps each action short)

    let offset = args.offset;
    let total: number | null = null;
    let done = false;

    for (let p = 0; p < CHUNK; p++) {
      const res = await fetch(`${DISCOVERY}?limit=${PAGE}&offset=${offset}`, {
        headers: { accept: "application/json" },
      });
      if (!res.ok) {
        done = true;
        break;
      }
      const data = await res.json();
      total = data.pagination?.total ?? total;
      const items = Array.isArray(data.items) ? data.items : [];
      if (items.length === 0) {
        done = true;
        break;
      }
      const byUrl = new Map<string, ReturnType<typeof mapItem>>();
      for (const it of items) {
        const m = mapItem(it);
        if (m) byUrl.set(m.externalUrl, m);
      }
      const offers = [...byUrl.values()].filter(Boolean) as NonNullable<
        ReturnType<typeof mapItem>
      >[];
      if (offers.length) {
        await ctx.runMutation(api.offers.upsertExternalBulk, {
          platformSecret,
          now: runStart,
          offers,
        });
      }
      offset += items.length;
      if (total != null && offset >= total) {
        done = true;
        break;
      }
    }

    if (!done) {
      // More to go — continue the chain.
      await ctx.scheduler.runAfter(0, internal.ingest.refreshCatalog, {
        offset,
        runStart,
      });
    }
    // No stale-sweep here: the upsert skips no-op writes (doesn't touch
    // lastSeenAt on unchanged rows), so a lastSeenAt-based sweep would wrongly
    // flag present-but-unchanged offers. Removed sellers are rare and just 502
    // on buy; `offers.sweepStaleExternal` stays available for an occasional
    // manual full pass if dead listings ever pile up.
  },
});
