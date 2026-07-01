import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { mutation, query, QueryCtx, MutationCtx } from "./_generated/server";
import { Doc, Id } from "./_generated/dataModel";
import { computeReputation } from "./receipts";

// Ranking tiers for the default "top" browse:
//   sold/proven  → SOLD_BASE + reputation score (settled offers float to top)
//   native       → NATIVE_RANK (our curated supply, above the bulk)
//   proxied      → source qualityScore (0–100)
const SOLD_BASE = 10000;
const NATIVE_RANK = 1000;

// Counter helpers (cheap denormalized counts).
async function bumpCounter(ctx: MutationCtx, key: string, delta: number) {
  const row = await ctx.db
    .query("counters")
    .withIndex("by_key", (q) => q.eq("key", key))
    .first();
  if (row) await ctx.db.patch(row._id, { value: Math.max(0, row.value + delta) });
  else await ctx.db.insert("counters", { key, value: Math.max(0, delta) });
}

const PLATFORM_INTERNAL_KEY = process.env.PLATFORM_INTERNAL_KEY ?? "";

// Any exported query is reachable unauthenticated via the public Convex URL, so
// public reads must never return the seller's raw `endpoint` (may embed creds),
// the paid `fileUrl` deliverable, or the operator-private `internalHandler`.
export type PublicOffer = Omit<
  Doc<"offers">,
  "endpoint" | "fileUrl" | "internalHandler" | "externalUrl" | "source"
>;
// Strip operator-private fields. `externalUrl`/`source` are stripped too so a
// proxied external offer is indistinguishable from a native one to customers —
// to a buyer it's just an offer (we're the intermediary; that's our business).
function publicOffer(o: Doc<"offers">): PublicOffer {
  const { endpoint, fileUrl, internalHandler, externalUrl, source, ...rest } = o;
  void endpoint;
  void fileUrl;
  void internalHandler;
  void externalUrl;
  void source;
  return rest;
}

// Enrich a page of offers with seller name + receipt-derived reputation. Offers
// without a sellerId yet (an unsold proxied offer) fall back to their inline
// sellerName + empty reputation. Shared by the marketplace browse/search.
async function enrichOffers(ctx: QueryCtx, offers: Doc<"offers">[]) {
  const emptyRep = computeReputation([]);
  const sellerIds = [
    ...new Set(offers.filter((o) => o.sellerId).map((o) => String(o.sellerId))),
  ];
  const sellers = new Map<
    string,
    {
      name: string;
      receiptsSold: number;
      totalEarnedCents: number;
      reputation: ReturnType<typeof computeReputation>;
    }
  >();
  for (const id of sellerIds) {
    const sellerId = id as Id<"agents">;
    const agent = await ctx.db.get(sellerId);
    const sold = await ctx.db
      .query("receipts")
      .withIndex("by_sellerId", (q) => q.eq("sellerId", sellerId))
      .take(500);
    const reputation = computeReputation(sold);
    sellers.set(id, {
      name: agent?.name ?? "Unknown agent",
      receiptsSold: reputation.sales,
      totalEarnedCents: reputation.volumeCents,
      reputation,
    });
  }
  return offers.map((o) => ({
    _id: o._id,
    _creationTime: o._creationTime,
    title: o.title,
    description: o.description,
    category: o.category,
    tags: o.tags,
    priceCents: o.priceCents,
    // Exact USD price (sub-cent aware) — proxied offers are often $0.001, which
    // rounds to 0 cents; derive from the atomic amount so the real price shows.
    priceUsd: o.amountRaw ? Number(o.amountRaw) / 1e6 : o.priceCents / 100,
    offerType: o.offerType,
    inputSchema: o.inputSchema,
    outputSchema: o.outputSchema,
    previewDescription: o.previewDescription,
    seller: (o.sellerId && sellers.get(String(o.sellerId))) || {
      name: o.sellerName ?? "Provider",
      receiptsSold: 0,
      totalEarnedCents: 0,
      reputation: emptyRep,
    },
  }));
}

// Offers — what agents sell on PayanAgent.
// Two shapes:
//   api      = pay-per-call HTTP endpoint, x402-gated through PayanAgent
//   download = one-time digital deliverable, fileUrl revealed on settlement

export const create = mutation({
  args: {
    platformSecret: v.string(),
    sellerId: v.id("agents"),
    title: v.string(),
    description: v.string(),
    category: v.string(),
    tags: v.array(v.string()),
    priceCents: v.number(),
    offerType: v.union(v.literal("api"), v.literal("download")),
    endpoint: v.optional(v.string()),
    httpMethod: v.optional(v.string()),
    inputSchema: v.optional(v.string()),
    outputSchema: v.optional(v.string()),
    estimatedDurationSeconds: v.optional(v.number()),
    internalHandler: v.optional(v.string()),
    fileUrl: v.optional(v.string()),
    previewDescription: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<Id<"offers">> => {
    const { platformSecret, ...fields } = args;
    requireSecret(platformSecret);
    // API offers settle to either an external endpoint or a PayanAgent-operated
    // internal handler.
    if (fields.offerType === "api" && !fields.endpoint && !fields.internalHandler) {
      throw new Error("API offers require an endpoint or internalHandler");
    }
    if (fields.offerType === "download" && !fields.fileUrl) {
      throw new Error("Download offers require a fileUrl");
    }
    if (fields.priceCents < 1) {
      throw new Error("priceCents must be at least 1");
    }
    const id = await ctx.db.insert("offers", {
      ...fields,
      source: "native",
      rankScore: NATIVE_RANK,
      isActive: true,
    });
    await bumpCounter(ctx, "activeOffers", 1);
    return id;
  },
});

export const update = mutation({
  args: {
    platformSecret: v.string(),
    offerId: v.id("offers"),
    title: v.optional(v.string()),
    description: v.optional(v.string()),
    category: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
    priceCents: v.optional(v.number()),
    endpoint: v.optional(v.string()),
    httpMethod: v.optional(v.string()),
    inputSchema: v.optional(v.string()),
    outputSchema: v.optional(v.string()),
    estimatedDurationSeconds: v.optional(v.number()),
    fileUrl: v.optional(v.string()),
    previewDescription: v.optional(v.string()),
    isActive: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const { platformSecret, offerId, ...patch } = args;
    requireSecret(platformSecret);
    const offer = await ctx.db.get(offerId);
    if (!offer) throw new Error("Offer not found");
    await ctx.db.patch(offerId, patch);
  },
});

export const deactivate = mutation({
  args: { platformSecret: v.string(), offerId: v.id("offers") },
  handler: async (ctx, args) => {
    requireSecret(args.platformSecret);
    const offer = await ctx.db.get(args.offerId);
    await ctx.db.patch(args.offerId, { isActive: false });
    if (offer?.isActive) await bumpCounter(ctx, "activeOffers", -1);
  },
});

// --- queries ---

export const getById = query({
  args: { offerId: v.id("offers") },
  handler: async (ctx, args): Promise<PublicOffer | null> => {
    const offer = await ctx.db.get(args.offerId);
    return offer ? publicOffer(offer) : null;
  },
});

// Full offer doc incl. endpoint/fileUrl/internalHandler — platform-secret gated,
// for the settlement (buy) path only. Never exposed to public callers.
export const getByIdInternal = query({
  args: { offerId: v.id("offers"), platformSecret: v.string() },
  handler: async (ctx, args): Promise<Doc<"offers"> | null> => {
    if (!PLATFORM_INTERNAL_KEY || args.platformSecret !== PLATFORM_INTERNAL_KEY) {
      throw new Error("unauthorized: invalid platform secret");
    }
    return await ctx.db.get(args.offerId);
  },
});

export const listActive = query({
  args: {
    offerType: v.optional(v.union(v.literal("api"), v.literal("download"))),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<PublicOffer[]> => {
    const limit = Math.min(args.limit ?? 100, 500);
    if (args.offerType) {
      const rows = await ctx.db
        .query("offers")
        .withIndex("by_offerType", (q) =>
          q.eq("offerType", args.offerType!).eq("isActive", true),
        )
        .order("desc")
        .take(limit);
      return rows.map(publicOffer);
    }
    const rows = await ctx.db
      .query("offers")
      .filter((q) => q.eq(q.field("isActive"), true))
      .order("desc")
      .take(limit);
    return rows.map(publicOffer);
  },
});

// Offers list enriched with seller name + receipt-derived reputation, for the
// marketplace UI. Returns a projected shape: endpoint and fileUrl are private
// (fileUrl is the paid deliverable) and never leave the server here.
export const listActiveWithSellers = query({
  args: {
    offerType: v.optional(v.union(v.literal("api"), v.literal("download"))),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = Math.min(args.limit ?? 100, 500);
    let offers: Doc<"offers">[];
    if (args.offerType) {
      offers = await ctx.db
        .query("offers")
        .withIndex("by_offerType", (q) =>
          q.eq("offerType", args.offerType!).eq("isActive", true),
        )
        .order("desc")
        .take(limit);
    } else {
      offers = await ctx.db
        .query("offers")
        .filter((q) => q.eq(q.field("isActive"), true))
        .order("desc")
        .take(limit);
    }

    // Resolve each registered seller once (offers without a sellerId yet — an
    // unsold proxied offer — use their inline sellerName + empty reputation).
    const emptyRep = computeReputation([]);
    const sellerIds = [
      ...new Set(offers.filter((o) => o.sellerId).map((o) => String(o.sellerId))),
    ];
    const sellers = new Map<
      string,
      {
        name: string;
        receiptsSold: number;
        totalEarnedCents: number;
        reputation: ReturnType<typeof computeReputation>;
      }
    >();
    for (const id of sellerIds) {
      const sellerId = id as Id<"agents">;
      const agent = await ctx.db.get(sellerId);
      const sold = await ctx.db
        .query("receipts")
        .withIndex("by_sellerId", (q) => q.eq("sellerId", sellerId))
        .take(500);
      const reputation = computeReputation(sold);
      sellers.set(id, {
        name: agent?.name ?? "Unknown agent",
        receiptsSold: reputation.sales,
        totalEarnedCents: reputation.volumeCents,
        reputation,
      });
    }

    return offers.map((o) => ({
      _id: o._id,
      _creationTime: o._creationTime,
      sellerId: o.sellerId,
      title: o.title,
      description: o.description,
      category: o.category,
      tags: o.tags,
      priceCents: o.priceCents,
      offerType: o.offerType,
      inputSchema: o.inputSchema,
      outputSchema: o.outputSchema,
      estimatedDurationSeconds: o.estimatedDurationSeconds,
      previewDescription: o.previewDescription,
      seller: (o.sellerId && sellers.get(String(o.sellerId))) || {
        name: o.sellerName ?? "Provider",
        receiptsSold: 0,
        totalEarnedCents: 0,
        reputation: emptyRep,
      },
    }));
  },
});

// The discovery document (/openapi.json, /.well-known/x402): ALL native offers
// (curated, small) + the top proxied offers (Base, buyable, quality-ranked) so
// the manifest advertises that we carry the market without ballooning to 24.7k.
// The full catalog stays searchable via `search`. Returns public + payment
// fields incl. exact x402 terms (external carry real atomic amount/asset/network;
// native derive from priceCents + Base USDC).
export const listForDiscovery = query({
  args: { ecoLimit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const ecoLimit = Math.min(args.ecoLimit ?? 100, 300);
    const emptyRep = computeReputation([]);

    // One ranked read: rankScore already encodes the right order globally
    // (sold tier > native > source quality), so the top of by_rank is exactly
    // "every native + the genuinely best externals" — not a recency window.
    const ranked = await ctx.db
      .query("offers")
      .withIndex("by_rank", (q) => q.eq("isActive", true))
      .order("desc")
      .take(300 + ecoLimit);
    const native = ranked.filter((o) => o.source === "native");
    const extTop = ranked.filter((o) => o.source !== "native").slice(0, ecoLimit);

    const all = [...native, ...extTop];

    const sellers = new Map<
      string,
      {
        wallet: string | null;
        name: string;
        reputation: ReturnType<typeof computeReputation>;
      }
    >();
    for (const id of new Set(all.filter((o) => o.sellerId).map((o) => String(o.sellerId)))) {
      const sellerId = id as Id<"agents">;
      const seller = await ctx.db.get(sellerId);
      const sold = await ctx.db
        .query("receipts")
        .withIndex("by_sellerId", (q) => q.eq("sellerId", sellerId))
        .take(500);
      sellers.set(id, {
        wallet: seller?.walletAddress ?? null,
        name: seller?.name ?? "Unknown agent",
        reputation: computeReputation(sold),
      });
    }

    return all.map((o) => {
      const s = o.sellerId ? sellers.get(String(o.sellerId)) : undefined;
      return {
        _id: o._id,
        title: o.title,
        description: o.description,
        category: o.category,
        priceCents: o.priceCents,
        offerType: o.offerType,
        inputSchema: o.inputSchema,
        outputSchema: o.outputSchema,
        sellerWallet: s?.wallet ?? o.payTo ?? null,
        sellerName: s?.name ?? o.sellerName ?? "Provider",
        reputation: s?.reputation ?? emptyRep,
        // Exact x402 payment terms (undefined for native → caller derives).
        amountRaw: o.amountRaw,
        asset: o.asset,
        network: o.network,
      };
    });
  },
});

export const listBySeller = query({
  args: {
    sellerId: v.id("agents"),
    includeInactive: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<PublicOffer[]> => {
    if (args.includeInactive) {
      const rows = await ctx.db
        .query("offers")
        .filter((q) => q.eq(q.field("sellerId"), args.sellerId))
        .collect();
      return rows.map(publicOffer);
    }
    const rows = await ctx.db
      .query("offers")
      .withIndex("by_sellerId", (q) =>
        q.eq("sellerId", args.sellerId).eq("isActive", true),
      )
      .collect();
    return rows.map(publicOffer);
  },
});

export const listByCategory = query({
  args: {
    category: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<PublicOffer[]> => {
    const limit = Math.min(args.limit ?? 50, 200);
    const rows = await ctx.db
      .query("offers")
      .withIndex("by_category", (q) =>
        q.eq("category", args.category).eq("isActive", true),
      )
      .take(limit);
    return rows.map(publicOffer);
  },
});

export const search = query({
  args: {
    query: v.string(),
    category: v.optional(v.string()),
    offerType: v.optional(v.union(v.literal("api"), v.literal("download"))),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<PublicOffer[]> => {
    const limit = Math.min(args.limit ?? 50, 200);
    const rows = await ctx.db
      .query("offers")
      .withSearchIndex("search_offers", (q) => {
        let s = q.search("description", args.query).eq("isActive", true);
        if (args.category) s = s.eq("category", args.category);
        if (args.offerType) s = s.eq("offerType", args.offerType);
        return s;
      })
      .take(limit);
    return rows.map(publicOffer);
  },
});

// --- marketplace browse + search (paginated, enriched) ---

// Ranked, paginated browse of the whole market. `top` = quality/reputation rank
// (the sensible default — native + high-quality proxied first), `price` =
// cheapest first, `new` = most recent. Use with usePaginatedQuery for load-more.
export const browse = query({
  args: {
    sort: v.optional(v.union(v.literal("top"), v.literal("price"), v.literal("new"))),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    const sort = args.sort ?? "top";
    const result =
      sort === "price"
        ? await ctx.db
            .query("offers")
            .withIndex("by_price", (q) => q.eq("isActive", true))
            .order("asc")
            .paginate(args.paginationOpts)
        : sort === "new"
          ? await ctx.db
              .query("offers")
              .withIndex("by_active", (q) => q.eq("isActive", true))
              .order("desc")
              .paginate(args.paginationOpts)
          : await ctx.db
              .query("offers")
              .withIndex("by_rank", (q) => q.eq("isActive", true))
              .order("desc")
              .paginate(args.paginationOpts);
    return { ...result, page: await enrichOffers(ctx, result.page) };
  },
});

// Full-text search across the whole market, enriched. Relevance-ranked top N
// (refine the query rather than paginate).
export const searchPage = query({
  args: { query: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const limit = Math.min(args.limit ?? 40, 100);
    const rows = await ctx.db
      .query("offers")
      .withSearchIndex("search_offers", (q) =>
        q.search("description", args.query).eq("isActive", true),
      )
      .take(limit);
    return enrichOffers(ctx, rows);
  },
});

// --- proxied external offers (the aggregated launch inventory) ---

function requireSecret(secret: string) {
  if (!PLATFORM_INTERNAL_KEY || secret !== PLATFORM_INTERNAL_KEY) {
    throw new Error("unauthorized: invalid platform secret");
  }
}

// One ingested external listing, already normalized by the ingester. Upsert by
// `externalUrl` so re-ingestion is idempotent (refreshes lastSeenAt + reactivates).
const EXTERNAL_FIELDS = {
  externalUrl: v.string(),
  sellerName: v.optional(v.string()),
  title: v.string(),
  description: v.string(),
  category: v.string(),
  tags: v.array(v.string()),
  priceCents: v.number(),
  payTo: v.string(),
  asset: v.string(),
  network: v.string(),
  amountRaw: v.string(),
  inputSchema: v.optional(v.string()),
  outputSchema: v.optional(v.string()),
  qualityScore: v.optional(v.number()),
  sourceLastUpdated: v.optional(v.string()),
};

export const upsertExternalBulk = mutation({
  args: {
    platformSecret: v.string(),
    now: v.number(),
    offers: v.array(v.object(EXTERNAL_FIELDS)),
  },
  handler: async (ctx, args) => {
    requireSecret(args.platformSecret);
    let created = 0;
    let updated = 0;
    let reactivated = 0;
    let unchanged = 0;
    for (const f of args.offers) {
      const existing = await ctx.db
        .query("offers")
        .withIndex("by_externalUrl", (q) => q.eq("externalUrl", f.externalUrl))
        .first();
      if (existing) {
        // Skip the write entirely when nothing meaningful changed — the daily
        // refresh otherwise re-patches all ~24.8k rows for no reason.
        const same =
          existing.isActive &&
          existing.title === f.title &&
          existing.description === f.description &&
          existing.category === f.category &&
          existing.priceCents === f.priceCents &&
          existing.amountRaw === f.amountRaw &&
          existing.payTo === f.payTo &&
          existing.asset === f.asset &&
          existing.network === f.network &&
          (existing.inputSchema ?? null) === (f.inputSchema ?? null) &&
          (existing.outputSchema ?? null) === (f.outputSchema ?? null) &&
          (existing.qualityScore ?? null) === (f.qualityScore ?? null) &&
          (existing.sellerName ?? null) === (f.sellerName ?? null) &&
          JSON.stringify(existing.tags) === JSON.stringify(f.tags);
        if (same) {
          unchanged++;
          continue;
        }
        const wasInactive = !existing.isActive;
        await ctx.db.patch(existing._id, {
          ...f,
          source: "bazaar",
          offerType: "api" as const,
          // Preserve the "sold" rank tier; otherwise rank by source quality.
          rankScore:
            existing.rankScore != null && existing.rankScore >= SOLD_BASE
              ? existing.rankScore
              : f.qualityScore ?? 0,
          isActive: true,
          lastSeenAt: args.now,
        });
        if (wasInactive) reactivated++;
        else updated++;
      } else {
        await ctx.db.insert("offers", {
          ...f,
          source: "bazaar",
          offerType: "api" as const,
          rankScore: f.qualityScore ?? 0,
          isActive: true,
          lastSeenAt: args.now,
          // sellerId stays undefined until the first sale backfills it.
        });
        created++;
      }
    }
    const activated = created + reactivated;
    if (activated > 0) await bumpCounter(ctx, "activeOffers", activated);
    return { created, updated, reactivated, unchanged };
  },
});

// Deactivate proxied offers not seen since a cutoff (dropped from the source).
export const sweepStaleExternal = mutation({
  args: { platformSecret: v.string(), cutoff: v.number(), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    requireSecret(args.platformSecret);
    // Offers not refreshed this run (lastSeenAt before the cutoff) = dropped from
    // the source. The index gives us exactly those (not a scan of the whole table).
    const stale = await ctx.db
      .query("offers")
      .withIndex("by_source_lastSeen", (q) =>
        q.eq("source", "bazaar").lt("lastSeenAt", args.cutoff),
      )
      .take(Math.min(args.limit ?? 2000, 4000));
    let swept = 0;
    for (const o of stale) {
      if (o.isActive) {
        await ctx.db.patch(o._id, { isActive: false });
        swept++;
      }
    }
    if (swept > 0) await bumpCounter(ctx, "activeOffers", -swept);
    return { swept };
  },
});

// Cheap live offer count for the overview (reads one counter row).
export const activeCount = query({
  args: {},
  handler: async (ctx): Promise<number> => {
    const row = await ctx.db
      .query("counters")
      .withIndex("by_key", (q) => q.eq("key", "activeOffers"))
      .first();
    return row?.value ?? 0;
  },
});

// Count a page of active offers (for one-time counter init). Loop from a script.
export const countActivePage = query({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    const page = await ctx.db
      .query("offers")
      .withIndex("by_active", (q) => q.eq("isActive", true))
      .paginate(args.paginationOpts);
    return { count: page.page.length, isDone: page.isDone, continueCursor: page.continueCursor };
  },
});

// Set a counter to a known value (one-time init / repair). Gated.
export const setCounter = mutation({
  args: { platformSecret: v.string(), key: v.string(), value: v.number() },
  handler: async (ctx, args) => {
    requireSecret(args.platformSecret);
    const row = await ctx.db
      .query("counters")
      .withIndex("by_key", (q) => q.eq("key", args.key))
      .first();
    if (row) await ctx.db.patch(row._id, { value: args.value });
    else await ctx.db.insert("counters", { key: args.key, value: args.value });
  },
});

// Bump an offer into the "sold" rank tier (by its seller's reputation) after a
// settlement, so proven offers float to the top of the default browse. Gated.
export const bumpRankOnSale = mutation({
  args: { platformSecret: v.string(), offerId: v.id("offers") },
  handler: async (ctx, args) => {
    requireSecret(args.platformSecret);
    const offer = await ctx.db.get(args.offerId);
    if (!offer || !offer.sellerId) return;
    const sold = await ctx.db
      .query("receipts")
      .withIndex("by_sellerId", (q) => q.eq("sellerId", offer.sellerId!))
      .take(500);
    const rep = computeReputation(sold);
    await ctx.db.patch(args.offerId, { rankScore: SOLD_BASE + rep.score });
  },
});

// One-time: tag pre-existing native offers with source:"native" so the
// discovery split (native vs bazaar) works. Cheap — runs before external ingest
// when the table holds only our handful of offers.
export const backfillNativeSource = mutation({
  args: { platformSecret: v.string() },
  handler: async (ctx, args) => {
    requireSecret(args.platformSecret);
    const all = await ctx.db.query("offers").take(2000);
    let patched = 0;
    for (const o of all) {
      if (!o.source && !o.externalUrl) {
        await ctx.db.patch(o._id, { source: "native" });
        patched++;
      }
    }
    return { patched };
  },
});

// Deactivate proxied offers on non-Base networks (we only relay Base, so they
// would 501 on buy). Paginated; loop from a script until isDone. One-time.
export const deactivateNonBase = mutation({
  args: { platformSecret: v.string(), cursor: v.optional(v.string()) },
  handler: async (ctx, args) => {
    requireSecret(args.platformSecret);
    const page = await ctx.db
      .query("offers")
      .withIndex("by_source", (q) => q.eq("source", "bazaar").eq("isActive", true))
      .paginate({ numItems: 500, cursor: args.cursor ?? null });
    let deactivated = 0;
    for (const o of page.page) {
      if (o.network !== "eip155:8453" && o.network !== "base") {
        await ctx.db.patch(o._id, { isActive: false });
        deactivated++;
      }
    }
    if (deactivated > 0) await bumpCounter(ctx, "activeOffers", -deactivated);
    return { isDone: page.isDone, cursor: page.continueCursor, deactivated };
  },
});

// Backfill a proxied offer's seller once it makes its first sale (the relay
// creates the seller agent from payTo, then calls this). Idempotent.
export const backfillSeller = mutation({
  args: {
    platformSecret: v.string(),
    offerId: v.id("offers"),
    sellerId: v.id("agents"),
  },
  handler: async (ctx, args) => {
    requireSecret(args.platformSecret);
    const offer = await ctx.db.get(args.offerId);
    if (offer && !offer.sellerId) {
      await ctx.db.patch(args.offerId, { sellerId: args.sellerId });
    }
  },
});

// One-time: set rankScore on existing offers (proxied → qualityScore, native →
// boost). Paginated; loop from a script until isDone.
export const backfillRank = mutation({
  args: { platformSecret: v.string(), cursor: v.optional(v.string()) },
  handler: async (ctx, args) => {
    requireSecret(args.platformSecret);
    const page = await ctx.db
      .query("offers")
      .paginate({ numItems: 500, cursor: args.cursor ?? null });
    let patched = 0;
    for (const o of page.page) {
      let rank = o.source === "bazaar" ? (o.qualityScore ?? 0) : NATIVE_RANK;
      // Offers whose seller has sales float into the "sold" tier (receipt read
      // only happens for the few offers that have a seller — unsold proxied
      // offers have none).
      if (o.sellerId) {
        const sold = await ctx.db
          .query("receipts")
          .withIndex("by_sellerId", (q) => q.eq("sellerId", o.sellerId!))
          .take(500);
        const rep = computeReputation(sold);
        if (rep.sales > 0) rank = SOLD_BASE + rep.score;
      }
      if (o.rankScore !== rank) {
        await ctx.db.patch(o._id, { rankScore: rank });
        patched++;
      }
    }
    return { isDone: page.isDone, cursor: page.continueCursor, patched };
  },
});

