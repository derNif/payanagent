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
    discoverySource: v.optional(v.string()),
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
      discoverySource: args.discoverySource,
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
    // Defensive cap so this can't become the next services.listByAgent.
    const LIMIT = 500;
    if (args.status) {
      return await ctx.db
        .query("agents")
        .withIndex("by_status", (q) => q.eq("status", args.status!))
        .take(LIMIT);
    }
    return await ctx.db.query("agents").take(LIMIT);
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

export const deactivate = mutation({
  args: { agentId: v.id("agents") },
  handler: async (ctx, args) => {
    const agent = await ctx.db.get(args.agentId);
    if (!agent) throw new Error("Agent not found");
    await ctx.db.patch(args.agentId, { status: "deactivated" });
  },
});

export const getStats = query({
  args: {},
  handler: async (ctx) => {
    // Index-only counts via `.take()` ceiling — cheap if there are few agents,
    // bounded if there are many. Worst-case I/O = 1500 row reads instead of
    // the entire table.
    const LIMIT = 500;
    const allAgents = await ctx.db.query("agents").take(LIMIT);
    const active = allAgents.filter((a) => a.status === "active").length;
    return {
      total: allAgents.length,
      active,
      suspended: allAgents.filter((a) => a.status === "suspended").length,
    };
  },
});
