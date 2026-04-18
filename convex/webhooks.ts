import { v } from "convex/values";
import { mutation, query, internalQuery, internalMutation } from "./_generated/server";

export const create = mutation({
  args: {
    agentId: v.id("agents"),
    url: v.string(),
    events: v.array(v.string()),
    secret: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("webhooks", {
      agentId: args.agentId,
      url: args.url,
      events: args.events,
      secret: args.secret,
      isActive: true,
    });
  },
});

export const listByAgent = query({
  args: { agentId: v.id("agents") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("webhooks")
      .withIndex("by_agentId", (q) => q.eq("agentId", args.agentId))
      .collect();
  },
});

export const getActiveForEvent = query({
  args: { event: v.string() },
  handler: async (ctx, args) => {
    const active = await ctx.db
      .query("webhooks")
      .withIndex("by_event", (q) => q.eq("isActive", true))
      .collect();

    return active.filter((w) => w.events.includes(args.event));
  },
});

export const deactivate = mutation({
  args: { webhookId: v.id("webhooks") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.webhookId, { isActive: false });
  },
});

export const update = mutation({
  args: {
    webhookId: v.id("webhooks"),
    url: v.optional(v.string()),
    events: v.optional(v.array(v.string())),
    isActive: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const { webhookId, ...updates } = args;
    const filteredUpdates: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(updates)) {
      if (value !== undefined) {
        filteredUpdates[key] = value;
      }
    }
    await ctx.db.patch(webhookId, filteredUpdates);
  },
});

// ---------- internal: targets + delivery log (used by webhookSender action) ----------

// Return active webhooks for the given agent IDs that subscribe to `event`.
export const getTargetsForEvent = internalQuery({
  args: {
    agentIds: v.array(v.id("agents")),
    event: v.string(),
  },
  handler: async (ctx, args) => {
    const seen = new Set<string>();
    const results: Array<{
      _id: string;
      agentId: string;
      url: string;
      secret: string;
    }> = [];

    for (const agentId of args.agentIds) {
      const hooks = await ctx.db
        .query("webhooks")
        .withIndex("by_agentId", (q) => q.eq("agentId", agentId))
        .collect();

      for (const h of hooks) {
        if (!h.isActive) continue;
        if (!h.events.includes(args.event)) continue;
        if (seen.has(h._id)) continue;
        seen.add(h._id);
        results.push({
          _id: h._id,
          agentId: h.agentId,
          url: h.url,
          secret: h.secret,
        });
      }
    }

    return results;
  },
});

export const getSecret = internalQuery({
  args: { webhookId: v.id("webhooks") },
  handler: async (ctx, args) => {
    const w = await ctx.db.get(args.webhookId);
    if (!w) return null;
    return { secret: w.secret, url: w.url, isActive: w.isActive };
  },
});

export const logDelivery = internalMutation({
  args: {
    webhookId: v.id("webhooks"),
    agentId: v.id("agents"),
    url: v.string(),
    event: v.string(),
    jobId: v.optional(v.id("jobs")),
    attempt: v.number(),
    statusCode: v.optional(v.number()),
    error: v.optional(v.string()),
    durationMs: v.optional(v.number()),
    success: v.boolean(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("webhookDeliveries", args);
  },
});

// Public-read query for debugging / admin (optional use)
export const listDeliveries = query({
  args: {
    jobId: v.optional(v.id("jobs")),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 50;
    if (args.jobId) {
      return await ctx.db
        .query("webhookDeliveries")
        .withIndex("by_jobId", (q) => q.eq("jobId", args.jobId))
        .order("desc")
        .take(limit);
    }
    return await ctx.db.query("webhookDeliveries").order("desc").take(limit);
  },
});
