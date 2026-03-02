import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

export const create = mutation({
  args: {
    agentId: v.id("agents"),
    name: v.string(),
    description: v.string(),
    category: v.string(),
    tags: v.array(v.string()),
    serviceType: v.union(v.literal("api"), v.literal("job")),
    pricingModel: v.union(
      v.literal("per_request"),
      v.literal("per_job"),
      v.literal("per_token"),
      v.literal("hourly")
    ),
    priceInCents: v.number(),
    endpoint: v.optional(v.string()),
    httpMethod: v.optional(v.string()),
    inputSchema: v.optional(v.string()),
    outputSchema: v.optional(v.string()),
    maxInputTokens: v.optional(v.number()),
    estimatedDurationSeconds: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const agent = await ctx.db.get(args.agentId);
    if (!agent) throw new Error("Agent not found");
    if (agent.status !== "active") throw new Error("Agent is not active");

    return await ctx.db.insert("services", {
      ...args,
      isActive: true,
    });
  },
});

export const getById = query({
  args: { serviceId: v.id("services") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.serviceId);
  },
});

export const listByAgent = query({
  args: { agentId: v.id("agents") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("services")
      .withIndex("by_agentId", (q) => q.eq("agentId", args.agentId))
      .collect();
  },
});

export const listByCategory = query({
  args: { category: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("services")
      .withIndex("by_category", (q) =>
        q.eq("category", args.category).eq("isActive", true)
      )
      .collect();
  },
});

export const listActive = query({
  args: {
    serviceType: v.optional(v.union(v.literal("api"), v.literal("job"))),
  },
  handler: async (ctx, args) => {
    if (args.serviceType) {
      return await ctx.db
        .query("services")
        .withIndex("by_serviceType", (q) =>
          q.eq("serviceType", args.serviceType!).eq("isActive", true)
        )
        .collect();
    }
    return await ctx.db
      .query("services")
      .filter((q) => q.eq(q.field("isActive"), true))
      .collect();
  },
});

export const update = mutation({
  args: {
    serviceId: v.id("services"),
    name: v.optional(v.string()),
    description: v.optional(v.string()),
    priceInCents: v.optional(v.number()),
    isActive: v.optional(v.boolean()),
    endpoint: v.optional(v.string()),
    inputSchema: v.optional(v.string()),
    outputSchema: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { serviceId, ...updates } = args;
    const service = await ctx.db.get(serviceId);
    if (!service) throw new Error("Service not found");

    const filteredUpdates: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(updates)) {
      if (value !== undefined) {
        filteredUpdates[key] = value;
      }
    }

    await ctx.db.patch(serviceId, filteredUpdates);
  },
});

export const deactivate = mutation({
  args: { serviceId: v.id("services") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.serviceId, { isActive: false });
  },
});
