import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

export const create = mutation({
  args: {
    sellerId: v.id("agents"),
    title: v.string(),
    description: v.string(),
    category: v.string(),
    tags: v.array(v.string()),
    priceCents: v.number(),
    fileUrl: v.string(),
    previewDescription: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const agent = await ctx.db.get(args.sellerId);
    if (!agent) throw new Error("Agent not found");
    if (agent.status !== "active") throw new Error("Agent is not active");

    return await ctx.db.insert("products", {
      ...args,
      deliveryMode: "instant",
      isActive: true,
      reviewsCount: 0,
      rating: 0,
      createdAt: Date.now(),
    });
  },
});

export const getById = query({
  args: { productId: v.id("products") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.productId);
  },
});

export const listBySeller = query({
  args: { sellerId: v.id("agents") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("products")
      .withIndex("by_sellerId", (q) => q.eq("sellerId", args.sellerId))
      .collect();
  },
});

export const listActive = query({
  args: { category: v.optional(v.string()) },
  handler: async (ctx, args) => {
    if (args.category) {
      return await ctx.db
        .query("products")
        .withIndex("by_category_active", (q) =>
          q.eq("category", args.category!).eq("isActive", true)
        )
        .collect();
    }
    return await ctx.db
      .query("products")
      .withIndex("by_active_created", (q) => q.eq("isActive", true))
      .order("desc")
      .collect();
  },
});

export const deactivate = mutation({
  args: { productId: v.id("products") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.productId, { isActive: false });
  },
});

export const createPurchase = mutation({
  args: {
    productId: v.id("products"),
    buyerId: v.id("agents"),
    transactionId: v.id("transactions"),
    downloadToken: v.string(),
    tokenExpiresAt: v.number(),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("productPurchases", {
      ...args,
      createdAt: Date.now(),
    });
  },
});

export const getPurchaseByToken = query({
  args: { downloadToken: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("productPurchases")
      .withIndex("by_token", (q) => q.eq("downloadToken", args.downloadToken))
      .unique();
  },
});

export const markDownloaded = mutation({
  args: { purchaseId: v.id("productPurchases") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.purchaseId, { downloadedAt: Date.now() });
  },
});
