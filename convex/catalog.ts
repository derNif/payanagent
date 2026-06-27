import { v } from "convex/values";
import { query, QueryCtx } from "./_generated/server";
import { Doc, Id } from "./_generated/dataModel";
import { computeReputation } from "./receipts";

// ─────────────────────────────────────────────────────────────────────────────
// Unified catalog — the ONE read layer over both buyable sources: native offers
// (the `offers` table, we settle) and external ecosystem resources (the
// `externalResources` table, we relay). Every agent-facing surface (/api/v1/
// discover, /openapi.json, /.well-known/x402, SDK, MCP) reads from here, so the
// whole market is discoverable through one shape and buyable through one route
// (/x402/:id). Storage stays two tables (different lifecycles); coherence lives
// here, in the view.
// ─────────────────────────────────────────────────────────────────────────────

const BASE_NETWORKS = new Set(["eip155:8453", "base"]);

// One normalized, agent-friendly entry. `id` works directly with /x402/:id.
export type CatalogEntry = {
  id: string;
  source: "native" | "ecosystem";
  title: string;
  description: string;
  category: string;
  tags: string[];
  priceUsd: number;
  priceCents: number;
  offerType: "api" | "download";
  inputSchema?: string;
  outputSchema?: string;
  sellerName: string;
  sellerWallet: string | null;
  reputation: ReturnType<typeof computeReputation>;
  qualityScore?: number;
  buyable: boolean;
  // Exact on-chain payment terms (ecosystem entries carry the seller's real
  // atomic amount/asset/network; native entries omit these — their terms derive
  // from priceCents + Base USDC).
  amountRaw?: string;
  asset?: string;
  network?: string;
};

async function reputationFor(ctx: QueryCtx, sellerId: Id<"agents">) {
  const sold = await ctx.db
    .query("receipts")
    .withIndex("by_sellerId", (q) => q.eq("sellerId", sellerId))
    .take(500);
  return computeReputation(sold);
}

function ecoEntry(
  r: Doc<"externalResources">,
  reputation: ReturnType<typeof computeReputation>,
): CatalogEntry {
  const priceUsd = r.priceUsd ?? Number(r.amountRaw) / 1e6;
  return {
    id: String(r._id),
    source: "ecosystem",
    title: r.serviceName || r.resource,
    description: r.description,
    category: r.category,
    tags: r.tags,
    priceUsd,
    priceCents: Math.round(priceUsd * 100),
    offerType: "api",
    inputSchema: r.inputSchema,
    outputSchema: r.outputSchema,
    sellerName: r.serviceName || "Ecosystem seller",
    sellerWallet: r.payTo,
    reputation,
    qualityScore: r.qualityScore,
    buyable: BASE_NETWORKS.has(r.network),
    amountRaw: r.amountRaw,
    asset: r.asset,
    network: r.network,
  };
}

function nativeEntry(
  o: Doc<"offers">,
  sellerName: string,
  sellerWallet: string | null,
  reputation: ReturnType<typeof computeReputation>,
): CatalogEntry {
  return {
    id: String(o._id),
    source: "native",
    title: o.title,
    description: o.description,
    category: o.category,
    tags: o.tags,
    priceUsd: o.priceCents / 100,
    priceCents: o.priceCents,
    offerType: o.offerType,
    inputSchema: o.inputSchema,
    outputSchema: o.outputSchema,
    sellerName,
    sellerWallet,
    reputation,
    buyable: true,
  };
}

// Search the whole market (native + ecosystem) in one call. Native first
// (curated/ours), then ecosystem matches.
export const search = query({
  args: { query: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, args): Promise<CatalogEntry[]> => {
    const limit = Math.min(args.limit ?? 50, 100);

    const offers = await ctx.db
      .query("offers")
      .withSearchIndex("search_offers", (q) =>
        q.search("description", args.query).eq("isActive", true),
      )
      .take(limit);

    const out: CatalogEntry[] = [];
    for (const o of offers) {
      const agent = await ctx.db.get(o.sellerId);
      out.push(
        nativeEntry(
          o,
          agent?.name ?? "Unknown agent",
          agent?.walletAddress ?? null,
          await reputationFor(ctx, o.sellerId),
        ),
      );
    }

    const ext = await ctx.db
      .query("externalResources")
      .withSearchIndex("search_external", (q) =>
        q.search("description", args.query).eq("status", "active"),
      )
      .take(limit);
    for (const r of ext) {
      out.push(ecoEntry(r, computeReputation([])));
    }

    return out;
  },
});

// A single entry by id (native offer id OR external resource id) — for catalog
// detail / get-by-id. String-safe via normalizeId.
export const get = query({
  args: { id: v.string() },
  handler: async (ctx, args): Promise<CatalogEntry | null> => {
    const extId = ctx.db.normalizeId("externalResources", args.id);
    if (extId) {
      const r = await ctx.db.get(extId);
      return r && r.status === "active" ? ecoEntry(r, computeReputation([])) : null;
    }
    const offerId = ctx.db.normalizeId("offers", args.id);
    if (offerId) {
      const o = await ctx.db.get(offerId);
      if (!o || !o.isActive) return null;
      const agent = await ctx.db.get(o.sellerId);
      return nativeEntry(
        o,
        agent?.name ?? "Unknown agent",
        agent?.walletAddress ?? null,
        await reputationFor(ctx, o.sellerId),
      );
    }
    return null;
  },
});

// For the machine-discovery manifests (/openapi.json, /.well-known/x402): ALL
// native offers (curated, small) + the top ecosystem resources (Base, buyable,
// quality-ranked) so the manifests advertise that we carry the market without
// ballooning to 24.7k. The full catalog stays searchable via catalog.search.
export const forDiscovery = query({
  args: { ecoLimit: v.optional(v.number()) },
  handler: async (ctx, args): Promise<CatalogEntry[]> => {
    const ecoLimit = Math.min(args.ecoLimit ?? 100, 300);

    const offers = await ctx.db
      .query("offers")
      .filter((q) => q.eq(q.field("isActive"), true))
      .order("desc")
      .take(500);
    const out: CatalogEntry[] = [];
    for (const o of offers) {
      const agent = await ctx.db.get(o.sellerId);
      out.push(
        nativeEntry(
          o,
          agent?.name ?? "Unknown agent",
          agent?.walletAddress ?? null,
          await reputationFor(ctx, o.sellerId),
        ),
      );
    }

    // Pull a recent active batch, keep Base/buyable, rank by qualityScore.
    const batch = await ctx.db
      .query("externalResources")
      .withIndex("by_status", (q) => q.eq("status", "active"))
      .order("desc")
      .take(1500);
    const ranked = batch
      .filter((r) => BASE_NETWORKS.has(r.network))
      .sort((a, b) => (b.qualityScore ?? 0) - (a.qualityScore ?? 0))
      .slice(0, ecoLimit);
    for (const r of ranked) {
      out.push(ecoEntry(r, computeReputation([])));
    }

    return out;
  },
});
