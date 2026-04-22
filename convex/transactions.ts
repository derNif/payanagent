import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

export const create = mutation({
  args: {
    fromAgentId: v.id("agents"),
    toAgentId: v.optional(v.id("agents")),
    jobId: v.optional(v.id("jobs")),
    productId: v.optional(v.id("products")),
    amountCents: v.number(),
    currency: v.string(),
    chain: v.string(),
    network: v.string(),
    txHash: v.optional(v.string()),
    facilitatorUrl: v.string(),
    type: v.union(
      v.literal("escrow_deposit"),
      v.literal("escrow_release"),
      v.literal("direct_payment"),
      v.literal("refund"),
      v.literal("platform_fee")
    ),
    status: v.union(
      v.literal("pending"),
      v.literal("confirmed"),
      v.literal("failed"),
      v.literal("refunded")
    ),
    confirmedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("transactions", args);
  },
});

export const getById = query({
  args: { transactionId: v.id("transactions") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.transactionId);
  },
});

export const listByAgent = query({
  args: { agentId: v.id("agents") },
  handler: async (ctx, args) => {
    const sent = await ctx.db
      .query("transactions")
      .withIndex("by_fromAgentId", (q) => q.eq("fromAgentId", args.agentId))
      .collect();

    const received = await ctx.db
      .query("transactions")
      .withIndex("by_toAgentId", (q) => q.eq("toAgentId", args.agentId))
      .collect();

    return [...sent, ...received].sort(
      (a, b) => b._creationTime - a._creationTime
    );
  },
});

export const listByJob = query({
  args: { jobId: v.id("jobs") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("transactions")
      .withIndex("by_jobId", (q) => q.eq("jobId", args.jobId))
      .collect();
  },
});

export const updateStatus = mutation({
  args: {
    transactionId: v.id("transactions"),
    status: v.union(
      v.literal("pending"),
      v.literal("confirmed"),
      v.literal("failed"),
      v.literal("refunded")
    ),
    txHash: v.optional(v.string()),
    confirmedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { transactionId, ...updates } = args;
    const filteredUpdates: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(updates)) {
      if (value !== undefined) {
        filteredUpdates[key] = value;
      }
    }
    await ctx.db.patch(transactionId, filteredUpdates);
  },
});

export const listAll = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db
      .query("transactions")
      .order("desc")
      .collect();
  },
});

export const getVolumeStats = query({
  args: {},
  handler: async (ctx) => {
    const all = await ctx.db
      .query("transactions")
      .filter((q) => q.eq(q.field("status"), "confirmed"))
      .collect();

    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;

    let totalVolume = 0;
    let last24h = 0;
    let last7d = 0;

    for (const tx of all) {
      totalVolume += tx.amountCents;
      if (tx.confirmedAt && now - tx.confirmedAt < day) {
        last24h += tx.amountCents;
      }
      if (tx.confirmedAt && now - tx.confirmedAt < 7 * day) {
        last7d += tx.amountCents;
      }
    }

    return {
      totalVolume,
      last24h,
      last7d,
      totalTransactions: all.length,
    };
  },
});
