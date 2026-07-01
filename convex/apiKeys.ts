import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

// SECURITY: everything here is platform-gated. Convex functions are publicly
// callable; an ungated `create` would let anyone mint a valid API key for any
// agent (full account takeover). Only our server-side routes hold the secret.

const PLATFORM_INTERNAL_KEY = process.env.PLATFORM_INTERNAL_KEY ?? "";

function requireSecret(secret: string) {
  if (!PLATFORM_INTERNAL_KEY || secret !== PLATFORM_INTERNAL_KEY) {
    throw new Error("unauthorized: invalid platform secret");
  }
}

export const create = mutation({
  args: {
    platformSecret: v.string(),
    agentId: v.id("agents"),
    keyHash: v.string(),
    keyPrefix: v.string(),
    label: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    requireSecret(args.platformSecret);
    return await ctx.db.insert("apiKeys", {
      agentId: args.agentId,
      keyHash: args.keyHash,
      keyPrefix: args.keyPrefix,
      label: args.label,
      isActive: true,
    });
  },
});

export const getByHash = query({
  args: { platformSecret: v.string(), keyHash: v.string() },
  handler: async (ctx, args) => {
    requireSecret(args.platformSecret);
    return await ctx.db
      .query("apiKeys")
      .withIndex("by_keyHash", (q) => q.eq("keyHash", args.keyHash))
      .first();
  },
});

export const listByAgent = query({
  args: { platformSecret: v.string(), agentId: v.id("agents") },
  handler: async (ctx, args) => {
    requireSecret(args.platformSecret);
    return await ctx.db
      .query("apiKeys")
      .withIndex("by_agentId", (q) => q.eq("agentId", args.agentId))
      .collect();
  },
});

export const deactivate = mutation({
  args: { platformSecret: v.string(), keyId: v.id("apiKeys") },
  handler: async (ctx, args) => {
    requireSecret(args.platformSecret);
    await ctx.db.patch(args.keyId, { isActive: false });
  },
});

export const updateLastUsed = mutation({
  args: { platformSecret: v.string(), keyId: v.id("apiKeys") },
  handler: async (ctx, args) => {
    requireSecret(args.platformSecret);
    await ctx.db.patch(args.keyId, { lastUsedAt: Date.now() });
  },
});
