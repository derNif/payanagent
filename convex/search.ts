import { v } from "convex/values";
import { query } from "./_generated/server";

// Unified discovery for PayanAgent v0.2: agents + offers + open requests.
export const discoverV2 = query({
  args: {
    query: v.string(),
    category: v.optional(v.string()),
    maxPriceCents: v.optional(v.number()),
    offerType: v.optional(v.union(v.literal("api"), v.literal("download"))),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = Math.min(args.limit ?? 50, 200);

    const agents = await ctx.db
      .query("agents")
      .withSearchIndex("search_agents", (q) =>
        q.search("description", args.query).eq("status", "active"),
      )
      .take(limit);

    let offers = await ctx.db
      .query("offers")
      .withSearchIndex("search_offers", (q) => {
        let s = q.search("description", args.query).eq("isActive", true);
        if (args.category) s = s.eq("category", args.category);
        if (args.offerType) s = s.eq("offerType", args.offerType);
        return s;
      })
      .take(limit);

    if (args.maxPriceCents !== undefined) {
      offers = offers.filter((o) => o.priceCents <= args.maxPriceCents!);
    }

    const openRequests = await ctx.db
      .query("requests")
      .withSearchIndex("search_requests", (q) =>
        q.search("description", args.query).eq("status", "open"),
      )
      .take(limit);

    return { agents, offers, openRequests };
  },
});

// Agent-only search.
export const searchAgents = query({
  args: {
    query: v.string(),
    providerType: v.optional(
      v.union(v.literal("agent"), v.literal("saas"), v.literal("api")),
    ),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("agents")
      .withSearchIndex("search_agents", (q) => {
        let s = q.search("description", args.query).eq("status", "active");
        if (args.providerType) s = s.eq("providerType", args.providerType);
        return s;
      })
      .take(50);
  },
});

// Offer-only search.
export const searchOffers = query({
  args: {
    query: v.string(),
    category: v.optional(v.string()),
    offerType: v.optional(v.union(v.literal("api"), v.literal("download"))),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("offers")
      .withSearchIndex("search_offers", (q) => {
        let s = q.search("description", args.query).eq("isActive", true);
        if (args.category) s = s.eq("category", args.category);
        if (args.offerType) s = s.eq("offerType", args.offerType);
        return s;
      })
      .take(50);
  },
});
