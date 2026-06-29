// Ingest the x402 ecosystem catalog (CDP Bazaar discovery API) into PayanAgent's
// `externalResources` table, so the whole ecosystem is discoverable — and, via
// the proxy-buy path, buyable — through PayanAgent. Non-custodial: we only mirror
// each resource's own payTo.
//
// Usage:
//   PLATFORM_INTERNAL_KEY=... node scripts/ingest-bazaar.mjs <convexUrl> [--max-pages N] [--page-size N] [--all]
//
// The discovery endpoint is public (no auth). `--all` walks the full catalog;
// otherwise it stops after --max-pages (default 10).
import { ConvexHttpClient } from "convex/browser";
import { anyApi } from "convex/server";

const args = process.argv.slice(2);
const convexUrl = args.find((a) => !a.startsWith("--"));
const flag = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};
const ALL = args.includes("--all");
const DRY_RUN = args.includes("--dry-run");
const PAGE_SIZE = Math.min(Number(flag("--page-size", "100")), 100);
const MAX_PAGES = ALL ? Infinity : Number(flag("--max-pages", "10"));

const secret = process.env.PLATFORM_INTERNAL_KEY;
if (!DRY_RUN && (!convexUrl || !secret)) {
  console.error(
    "usage: PLATFORM_INTERNAL_KEY=... node scripts/ingest-bazaar.mjs <convexUrl> [--max-pages N] [--page-size N] [--all] [--dry-run]",
  );
  process.exit(1);
}

const DISCOVERY = "https://api.cdp.coinbase.com/platform/v2/x402/discovery/resources";
const USDC = {
  "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913": 6, // Base mainnet
  "0x036cbd53842c5426634e7929541ec2318f3dcf7e": 6, // Base sepolia
};

const client = DRY_RUN ? null : new ConvexHttpClient(convexUrl);
const S = (o) => (o == null ? undefined : JSON.stringify(o));

// Pick the payment term we'd route through: prefer Base-mainnet USDC `exact`,
// avoiding the permit2 duplicate; else first Base term; else first term.
function pickAccept(accepts) {
  if (!Array.isArray(accepts) || accepts.length === 0) return null;
  const base = accepts.filter((a) => a.network === "eip155:8453" && a.scheme === "exact");
  const usdcPlain = base.find(
    (a) => USDC[String(a.asset).toLowerCase()] && !a.extra?.assetTransferMethod,
  );
  return usdcPlain || base[0] || accepts[0];
}

function priceUsd(accept) {
  const dec = USDC[String(accept.asset).toLowerCase()];
  if (!dec) return undefined;
  const n = Number(accept.amount);
  return Number.isFinite(n) ? n / 10 ** dec : undefined;
}

function qualityScore(q) {
  if (typeof q === "number") return q;
  if (q && typeof q === "object" && typeof q.score === "number") return q.score;
  return undefined;
}

// Map a Bazaar item → a proxied OFFER payload (offers.upsertExternalBulk).
const BASE_NETWORKS = new Set(["eip155:8453", "base"]);

function mapItem(item) {
  if (!item?.resource) return null;
  const accept = pickAccept(item.accepts);
  if (!accept?.payTo || !accept?.asset || !accept?.network) return null;
  // We only relay Base — don't list what we can't sell.
  if (!BASE_NETWORKS.has(accept.network)) return null;
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

let offset = 0;
let page = 0;
let totalCreated = 0;
let totalUpdated = 0;
let total = null;

while (page < MAX_PAGES) {
  const url = `${DISCOVERY}?limit=${PAGE_SIZE}&offset=${offset}`;
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) {
    console.error(`discovery ${res.status} at offset ${offset}; stopping.`);
    break;
  }
  const data = await res.json();
  const items = Array.isArray(data.items) ? data.items : [];
  total = data.pagination?.total ?? total;
  if (items.length === 0) break;

  // Dedupe within the page by externalUrl (the source can repeat URLs).
  const byUrl = new Map();
  for (const it of items) {
    const m = mapItem(it);
    if (m) byUrl.set(m.externalUrl, m);
  }
  const offersBatch = [...byUrl.values()];

  if (DRY_RUN) {
    if (page === 0) {
      console.log("--- dry-run: first 2 mapped offers ---");
      console.log(JSON.stringify(offersBatch.slice(0, 2), null, 2));
    }
    totalCreated += offersBatch.length; // count mapped (not written)
  } else if (offersBatch.length) {
    const r = await client.mutation(anyApi.offers.upsertExternalBulk, {
      platformSecret: secret,
      now: Date.now(),
      offers: offersBatch,
    });
    totalCreated += r.created;
    totalUpdated += r.updated;
  }

  page++;
  offset += items.length;
  console.log(
    `page ${page} (offset ${offset}/${total ?? "?"}): +${totalCreated} new, ${totalUpdated} updated`,
  );
  if (total != null && offset >= total) break;
}

console.log(`done. created ${totalCreated}, updated ${totalUpdated}, scanned ${offset} of ${total ?? "?"}.`);
