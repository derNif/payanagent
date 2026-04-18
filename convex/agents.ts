import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

export const create = mutation({
  args: {
    name: v.string(),
    description: v.string(),
    walletAddress: v.string(),
    chain: v.optional(v.string()),
    tags: v.array(v.string()),
    providerType: v.union(
      v.literal("agent"),
      v.literal("saas"),
      v.literal("api")
    ),
    agentUrl: v.optional(v.string()),
    ownerEmail: v.optional(v.string()),
    a2aCapabilities: v.optional(
      v.object({
        streaming: v.boolean(),
        pushNotifications: v.boolean(),
      })
    ),
  },
  handler: async (ctx, args) => {
    const agentId = await ctx.db.insert("agents", {
      name: args.name,
      description: args.description,
      walletAddress: args.walletAddress,
      chain: args.chain ?? "base",
      tags: args.tags,
      providerType: args.providerType,
      agentUrl: args.agentUrl,
      ownerEmail: args.ownerEmail,
      a2aCapabilities: args.a2aCapabilities,
      averageRating: 0,
      totalReviews: 0,
      totalJobsCompleted: 0,
      totalJobsFailed: 0,
      totalEarned: 0,
      totalSpent: 0,
      status: "active",
    });
    return agentId;
  },
});

export const getById = query({
  args: { agentId: v.id("agents") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.agentId);
  },
});

export const getByWallet = query({
  args: { walletAddress: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("agents")
      .withIndex("by_walletAddress", (q) =>
        q.eq("walletAddress", args.walletAddress)
      )
      .first();
  },
});

export const list = query({
  args: {
    status: v.optional(
      v.union(
        v.literal("active"),
        v.literal("suspended"),
        v.literal("deactivated")
      )
    ),
  },
  handler: async (ctx, args) => {
    if (args.status) {
      return await ctx.db
        .query("agents")
        .withIndex("by_status", (q) => q.eq("status", args.status!))
        .collect();
    }
    return await ctx.db.query("agents").collect();
  },
});

export const update = mutation({
  args: {
    agentId: v.id("agents"),
    name: v.optional(v.string()),
    description: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
    agentUrl: v.optional(v.string()),
    ownerEmail: v.optional(v.string()),
    a2aCapabilities: v.optional(
      v.object({
        streaming: v.boolean(),
        pushNotifications: v.boolean(),
      })
    ),
  },
  handler: async (ctx, args) => {
    const { agentId, ...updates } = args;
    const agent = await ctx.db.get(agentId);
    if (!agent) throw new Error("Agent not found");

    // Filter out undefined values
    const filteredUpdates: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(updates)) {
      if (value !== undefined) {
        filteredUpdates[key] = value;
      }
    }

    await ctx.db.patch(agentId, filteredUpdates);
  },
});

export const updateReputation = mutation({
  args: {
    agentId: v.id("agents"),
    newRating: v.optional(v.number()),
    jobCompleted: v.optional(v.boolean()),
    jobFailed: v.optional(v.boolean()),
    earned: v.optional(v.number()),
    spent: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const agent = await ctx.db.get(args.agentId);
    if (!agent) throw new Error("Agent not found");

    const updates: Record<string, unknown> = {};

    if (args.newRating !== undefined) {
      const totalRatingSum = agent.averageRating * agent.totalReviews;
      const newTotal = agent.totalReviews + 1;
      updates.averageRating =
        Math.round(((totalRatingSum + args.newRating) / newTotal) * 100) / 100;
      updates.totalReviews = newTotal;
    }

    if (args.jobCompleted) {
      updates.totalJobsCompleted = agent.totalJobsCompleted + 1;
    }

    if (args.jobFailed) {
      updates.totalJobsFailed = agent.totalJobsFailed + 1;
    }

    if (args.earned) {
      updates.totalEarned = agent.totalEarned + args.earned;
    }

    if (args.spent) {
      updates.totalSpent = agent.totalSpent + args.spent;
    }

    await ctx.db.patch(args.agentId, updates);
  },
});

export const deactivate = mutation({
  args: { agentId: v.id("agents") },
  handler: async (ctx, args) => {
    const agent = await ctx.db.get(args.agentId);
    if (!agent) throw new Error("Agent not found");
    await ctx.db.patch(args.agentId, { status: "deactivated" });
  },
});

export const listLeaderboard = query({
  args: {
    limit: v.optional(v.number()),
    sort: v.optional(
      v.union(
        v.literal("rating"),
        v.literal("earnings"),
        v.literal("jobs"),
      ),
    ),
  },
  handler: async (ctx, args) => {
    const limit = Math.min(args.limit ?? 50, 100);
    const sort = args.sort ?? "rating";

    const active = await ctx.db
      .query("agents")
      .withIndex("by_status", (q) => q.eq("status", "active"))
      .collect();

    const sorted = active
      .filter((a) => a.totalJobsCompleted > 0)
      .sort((a, b) => {
        const primary =
          sort === "earnings"
            ? b.totalEarned - a.totalEarned
            : sort === "jobs"
              ? b.totalJobsCompleted - a.totalJobsCompleted
              : b.averageRating - a.averageRating;
        if (primary !== 0) return primary;
        if (b.totalReviews !== a.totalReviews)
          return b.totalReviews - a.totalReviews;
        return b.totalJobsCompleted - a.totalJobsCompleted;
      })
      .slice(0, limit);

    return sorted.map((a) => ({
      _id: a._id,
      name: a.name,
      providerType: a.providerType,
      averageRating: a.averageRating,
      totalReviews: a.totalReviews,
      totalJobsCompleted: a.totalJobsCompleted,
      totalEarnedCents: a.totalEarned,
    }));
  },
});

export const getStats = query({
  args: {},
  handler: async (ctx) => {
    const allAgents = await ctx.db.query("agents").collect();
    const active = allAgents.filter((a) => a.status === "active").length;
    return {
      total: allAgents.length,
      active,
      suspended: allAgents.filter((a) => a.status === "suspended").length,
    };
  },
});
