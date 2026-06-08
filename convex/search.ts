import { v } from "convex/values";
import { query } from "./_generated/server";

export const searchAgents = query({
  args: {
    query: v.string(),
    providerType: v.optional(
      v.union(v.literal("agent"), v.literal("saas"), v.literal("api"))
    ),
  },
  handler: async (ctx, args) => {
    let search = ctx.db
      .query("agents")
      .withSearchIndex("search_agents", (q) => {
        let s = q.search("description", args.query);
        s = s.eq("status", "active");
        if (args.providerType) {
          s = s.eq("providerType", args.providerType);
        }
        return s;
      });

    return await search.take(50);
  },
});

export const searchServices = query({
  args: {
    query: v.string(),
    category: v.optional(v.string()),
    serviceType: v.optional(v.union(v.literal("api"), v.literal("job"))),
  },
  handler: async (ctx, args) => {
    let search = ctx.db
      .query("services")
      .withSearchIndex("search_services", (q) => {
        let s = q.search("description", args.query);
        s = s.eq("isActive", true);
        if (args.category) {
          s = s.eq("category", args.category);
        }
        if (args.serviceType) {
          s = s.eq("serviceType", args.serviceType);
        }
        return s;
      });

    return await search.take(50);
  },
});

// v0.2 unified discovery: agents + offers + open requests.
// Replaces the v1 discover (which searched services + jobs) at cut-over.
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

// Unified discovery (legacy): search agents, services, and open jobs
export const discover = query({
  args: {
    query: v.string(),
    category: v.optional(v.string()),
    minRating: v.optional(v.number()),
    maxPriceCents: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    // Search agents
    const agents = await ctx.db
      .query("agents")
      .withSearchIndex("search_agents", (q) =>
        q.search("description", args.query).eq("status", "active")
      )
      .take(50);

    // Search services
    let serviceSearch = ctx.db
      .query("services")
      .withSearchIndex("search_services", (q) => {
        let s = q.search("description", args.query).eq("isActive", true);
        if (args.category) {
          s = s.eq("category", args.category);
        }
        return s;
      });

    let services = await serviceSearch.take(50);

    // Apply price filter
    if (args.maxPriceCents) {
      services = services.filter(
        (s) => s.priceInCents <= args.maxPriceCents!
      );
    }

    // Apply rating filter to agents
    const filteredAgents = args.minRating
      ? agents.filter((a) => (a.averageRating ?? 0) >= args.minRating!)
      : agents;

    // Get open jobs matching the query (by searching job descriptions)
    const openJobs = await ctx.db
      .query("jobs")
      .withIndex("by_jobType_status", (q) =>
        q.eq("jobType", "open").eq("status", "open")
      )
      .collect();

    const queryLower = args.query.toLowerCase();
    const matchingJobs = openJobs.filter(
      (j) =>
        j.title.toLowerCase().includes(queryLower) ||
        j.description.toLowerCase().includes(queryLower)
    );

    return {
      agents: filteredAgents,
      services,
      openJobs: matchingJobs,
    };
  },
});
