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

    return await search.collect();
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

    return await search.collect();
  },
});

// Unified discovery: search agents, services, and open jobs
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
      .collect();

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

    let services = await serviceSearch.collect();

    // Apply price filter
    if (args.maxPriceCents) {
      services = services.filter(
        (s) => s.priceInCents <= args.maxPriceCents!
      );
    }

    // Apply rating filter to agents
    const filteredAgents = args.minRating
      ? agents.filter((a) => a.averageRating >= args.minRating!)
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
