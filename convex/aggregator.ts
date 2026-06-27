import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { Doc } from "./_generated/dataModel";

// The aggregator mirrors the external x402 ecosystem (CDP Bazaar) into
// PayanAgent so those resources are discoverable — and, on the proxy-buy path,
// buyable — *through* us. Non-custodial by construction: we only store the
// external seller's own payTo; no funds ever route through PayanAgent here.

const PLATFORM_INTERNAL_KEY = process.env.PLATFORM_INTERNAL_KEY ?? "";

function requireSecret(secret: string) {
  if (!PLATFORM_INTERNAL_KEY || secret !== PLATFORM_INTERNAL_KEY) {
    throw new Error("unauthorized: invalid platform secret");
  }
}

// One discovered resource, already normalized by the ingester (price terms
// chosen, schemas stringified). Upsert by canonical URL so re-ingestion is
// idempotent and refreshes lastSeenAt / status.
const RESOURCE_FIELDS = {
  source: v.string(),
  resource: v.string(),
  serviceName: v.optional(v.string()),
  description: v.string(),
  tags: v.array(v.string()),
  category: v.string(),
  type: v.optional(v.string()),
  iconUrl: v.optional(v.string()),
  amountRaw: v.string(),
  asset: v.string(),
  network: v.string(),
  payTo: v.string(),
  scheme: v.string(),
  priceUsd: v.optional(v.number()),
  inputSchema: v.optional(v.string()),
  outputSchema: v.optional(v.string()),
  x402Version: v.optional(v.number()),
  qualityScore: v.optional(v.number()),
  sourceLastUpdated: v.optional(v.string()),
};

export const upsertExternalResource = mutation({
  args: { platformSecret: v.string(), now: v.number(), ...RESOURCE_FIELDS },
  handler: async (ctx, args) => {
    const { platformSecret, now, ...fields } = args;
    requireSecret(platformSecret);

    const existing = await ctx.db
      .query("externalResources")
      .withIndex("by_resource", (q) => q.eq("resource", fields.resource))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        ...fields,
        lastSeenAt: now,
        status: "active" as const,
      });
      return { created: false };
    }

    await ctx.db.insert("externalResources", {
      ...fields,
      firstSeenAt: now,
      lastSeenAt: now,
      status: "active" as const,
    });
    return { created: true };
  },
});

// Bulk upsert — one call per page of the source catalog (the Bazaar has tens of
// thousands of resources, so per-row round-trips are far too slow).
export const upsertExternalResourcesBulk = mutation({
  args: {
    platformSecret: v.string(),
    now: v.number(),
    resources: v.array(v.object(RESOURCE_FIELDS)),
  },
  handler: async (ctx, args) => {
    requireSecret(args.platformSecret);
    let created = 0;
    let updated = 0;
    for (const fields of args.resources) {
      const existing = await ctx.db
        .query("externalResources")
        .withIndex("by_resource", (q) => q.eq("resource", fields.resource))
        .first();
      if (existing) {
        await ctx.db.patch(existing._id, {
          ...fields,
          lastSeenAt: args.now,
          status: "active" as const,
        });
        updated++;
      } else {
        await ctx.db.insert("externalResources", {
          ...fields,
          firstSeenAt: args.now,
          lastSeenAt: args.now,
          status: "active" as const,
        });
        created++;
      }
    }
    return { created, updated };
  },
});

// Mark resources not seen since a cutoff as stale (dropped from the live source).
export const markStaleBefore = mutation({
  args: { platformSecret: v.string(), cutoff: v.number(), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    requireSecret(args.platformSecret);
    const stale = await ctx.db
      .query("externalResources")
      .withIndex("by_status", (q) => q.eq("status", "active").lt("lastSeenAt", args.cutoff))
      .take(Math.min(args.limit ?? 500, 2000));
    for (const r of stale) {
      await ctx.db.patch(r._id, { status: "stale" as const });
    }
    return { marked: stale.length };
  },
});

// Public read — projected (no internal bookkeeping leaks; resource URL + payTo
// are inherently public x402 discovery data).
function publicResource(r: Doc<"externalResources">) {
  return {
    _id: r._id,
    resource: r.resource,
    serviceName: r.serviceName,
    description: r.description,
    tags: r.tags,
    category: r.category,
    iconUrl: r.iconUrl,
    amountRaw: r.amountRaw,
    asset: r.asset,
    network: r.network,
    payTo: r.payTo,
    scheme: r.scheme,
    priceUsd: r.priceUsd,
    inputSchema: r.inputSchema,
    outputSchema: r.outputSchema,
    qualityScore: r.qualityScore,
    lastSeenAt: r.lastSeenAt,
  };
}

export const listExternal = query({
  args: {
    network: v.optional(v.string()),
    category: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = Math.min(args.limit ?? 60, 200);
    let rows: Doc<"externalResources">[];
    if (args.network) {
      rows = await ctx.db
        .query("externalResources")
        .withIndex("by_network", (q) =>
          q.eq("network", args.network!).eq("status", "active"),
        )
        .take(limit);
    } else if (args.category) {
      rows = await ctx.db
        .query("externalResources")
        .withIndex("by_category", (q) =>
          q.eq("category", args.category!).eq("status", "active"),
        )
        .take(limit);
    } else {
      rows = await ctx.db
        .query("externalResources")
        .withIndex("by_status", (q) => q.eq("status", "active"))
        .order("desc")
        .take(limit);
    }
    return rows.map(publicResource);
  },
});

export const searchExternal = query({
  args: { query: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const limit = Math.min(args.limit ?? 60, 200);
    const rows = await ctx.db
      .query("externalResources")
      .withSearchIndex("search_external", (q) =>
        q.search("description", args.query).eq("status", "active"),
      )
      .take(limit);
    return rows.map(publicResource);
  },
});

// Headline counts for the aggregator surface. Capped scan (the table can grow
// to tens of thousands; this is an indicative count, not an exact census).
export const getExternalStats = query({
  args: {},
  handler: async (ctx) => {
    const sample = await ctx.db
      .query("externalResources")
      .withIndex("by_status", (q) => q.eq("status", "active"))
      .take(10000);
    const networks = new Set(sample.map((r) => r.network));
    const categories = new Set(sample.map((r) => r.category));
    return {
      count: sample.length,
      capped: sample.length === 10000,
      networks: networks.size,
      categories: [...categories].sort(),
    };
  },
});
