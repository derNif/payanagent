import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { Doc, Id } from "./_generated/dataModel";

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
    fileUrl: v.optional(v.string()),
    previewDescription: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<Id<"offers">> => {
    if (args.offerType === "api" && !args.endpoint) {
      throw new Error("API offers require an endpoint");
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
  handler: async (ctx, args): Promise<Doc<"offers"> | null> => {
    return await ctx.db.get(args.offerId);
  },
});

export const listActive = query({
  args: {
    offerType: v.optional(v.union(v.literal("api"), v.literal("download"))),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<Doc<"offers">[]> => {
    const limit = Math.min(args.limit ?? 100, 500);
    if (args.offerType) {
      return await ctx.db
        .query("offers")
        .withIndex("by_offerType", (q) =>
          q.eq("offerType", args.offerType!).eq("isActive", true),
        )
        .order("desc")
        .take(limit);
    }
    return await ctx.db
      .query("offers")
      .filter((q) => q.eq(q.field("isActive"), true))
      .order("desc")
      .take(limit);
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
      { name: string; receiptsSold: number; totalEarnedCents: number }
    >();
    for (const id of sellerIds) {
      const sellerId = id as Id<"agents">;
      const agent = await ctx.db.get(sellerId);
      const sold = await ctx.db
        .query("receipts")
        .withIndex("by_sellerId", (q) => q.eq("sellerId", sellerId))
        .take(500);
      const confirmed = sold.filter((r) => r.status === "confirmed");
      sellers.set(id, {
        name: agent?.name ?? "Unknown agent",
        receiptsSold: confirmed.length,
        totalEarnedCents: confirmed.reduce((s, r) => s + r.amountCents, 0),
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

export const listBySeller = query({
  args: {
    sellerId: v.id("agents"),
    includeInactive: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<Doc<"offers">[]> => {
    if (args.includeInactive) {
      return await ctx.db
        .query("offers")
        .filter((q) => q.eq(q.field("sellerId"), args.sellerId))
        .collect();
    }
    return await ctx.db
      .query("offers")
      .withIndex("by_sellerId", (q) =>
        q.eq("sellerId", args.sellerId).eq("isActive", true),
      )
      .collect();
  },
});

export const listByCategory = query({
  args: {
    category: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<Doc<"offers">[]> => {
    const limit = Math.min(args.limit ?? 50, 200);
    return await ctx.db
      .query("offers")
      .withIndex("by_category", (q) =>
        q.eq("category", args.category).eq("isActive", true),
      )
      .take(limit);
  },
});

export const search = query({
  args: {
    query: v.string(),
    category: v.optional(v.string()),
    offerType: v.optional(v.union(v.literal("api"), v.literal("download"))),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<Doc<"offers">[]> => {
    const limit = Math.min(args.limit ?? 50, 200);
    return await ctx.db
      .query("offers")
      .withSearchIndex("search_offers", (q) => {
        let s = q.search("description", args.query).eq("isActive", true);
        if (args.category) s = s.eq("category", args.category);
        if (args.offerType) s = s.eq("offerType", args.offerType);
        return s;
      })
      .take(limit);
  },
});
