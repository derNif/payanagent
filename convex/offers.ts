import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { Doc, Id } from "./_generated/dataModel";
import { computeReputation } from "./receipts";

const PLATFORM_INTERNAL_KEY = process.env.PLATFORM_INTERNAL_KEY ?? "";

// Any exported query is reachable unauthenticated via the public Convex URL, so
// public reads must never return the seller's raw `endpoint` (may embed creds),
// the paid `fileUrl` deliverable, or the operator-private `internalHandler`.
export type PublicOffer = Omit<
  Doc<"offers">,
  "endpoint" | "fileUrl" | "internalHandler"
>;
function publicOffer(o: Doc<"offers">): PublicOffer {
  const { endpoint, fileUrl, internalHandler, ...rest } = o;
  void endpoint;
  void fileUrl;
  void internalHandler;
  return rest;
}

// Offers — what agents sell on PayanAgent.
// Two shapes:
//   api      = pay-per-call HTTP endpoint, x402-gated through PayanAgent
//   download = one-time digital deliverable, fileUrl revealed on settlement

export const create = mutation({
  args: {
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
    // API offers settle to either an external endpoint or a PayanAgent-operated
    // internal handler.
    if (args.offerType === "api" && !args.endpoint && !args.internalHandler) {
      throw new Error("API offers require an endpoint or internalHandler");
    }
    if (args.offerType === "download" && !args.fileUrl) {
      throw new Error("Download offers require a fileUrl");
    }
    if (args.priceCents < 1) {
      throw new Error("priceCents must be at least 1");
    }
    return await ctx.db.insert("offers", { ...args, isActive: true });
  },
});

export const update = mutation({
  args: {
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
    const { offerId, ...patch } = args;
    const offer = await ctx.db.get(offerId);
    if (!offer) throw new Error("Offer not found");
    await ctx.db.patch(offerId, patch);
  },
});

export const deactivate = mutation({
  args: { offerId: v.id("offers") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.offerId, { isActive: false });
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

    // Resolve each unique seller once: name + confirmed-receipt stats.
    // Capped reads per seller keep worst-case I/O bounded.
    const sellerIds = [...new Set(offers.map((o) => String(o.sellerId)))];
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
      seller: sellers.get(String(o.sellerId))!,
    }));
  },
});

// Active offers joined with the seller's wallet, for the conformant x402
// discovery document. Returns only public + payment fields (no endpoint/fileUrl/
// internalHandler). Capped reads.
export const listForDiscovery = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const limit = Math.min(args.limit ?? 200, 500);
    const offers = await ctx.db
      .query("offers")
      .filter((q) => q.eq(q.field("isActive"), true))
      .order("desc")
      .take(limit);

    // Resolve each unique seller once: wallet + name + receipt-derived
    // reputation, so a discovering agent sees the trust signal inline (no
    // second round-trip). Capped reads keep worst-case I/O bounded.
    const sellers = new Map<
      string,
      {
        wallet: string | null;
        name: string;
        reputation: ReturnType<typeof computeReputation>;
      }
    >();
    for (const id of new Set(offers.map((o) => String(o.sellerId)))) {
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

    return offers.map((o) => {
      const s = sellers.get(String(o.sellerId));
      return {
        _id: o._id,
        title: o.title,
        description: o.description,
        category: o.category,
        priceCents: o.priceCents,
        offerType: o.offerType,
        inputSchema: o.inputSchema,
        outputSchema: o.outputSchema,
        sellerWallet: s?.wallet ?? null,
        sellerName: s?.name ?? "Unknown agent",
        reputation: s?.reputation ?? null,
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
