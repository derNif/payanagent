import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

// PayanAgent v0.2 schema.
// New tables: agents (carried), offers, requests, bids, receipts, apiKeys.
// Legacy tables (services, products, jobs, transactions, reviews, webhooks, etc.)
// remain defined here as DEPRECATED for the transition window. v0.2 code never
// writes to them. They are dropped during cut-over (Step 10).
export default defineSchema({
  // ============================================================
  // v0.2 CORE — read & write from here
  // ============================================================

  agents: defineTable({
    name: v.string(),
    description: v.string(),
    walletAddress: v.string(),
    chain: v.string(),
    tags: v.array(v.string()),
    providerType: v.union(
      v.literal("agent"),
      v.literal("saas"),
      v.literal("api"),
    ),
    agentUrl: v.optional(v.string()),
    ownerEmail: v.optional(v.string()),

    // Operator-private growth attribution ("how did you find PayanAgent?").
    // Never exposed through public projections.
    discoverySource: v.optional(v.string()),

    // True for accounts auto-created from a wallet on an anonymous x402 buy
    // (no registration). The wallet is the identity; can be "claimed" later.
    autoCreated: v.optional(v.boolean()),

    a2aCapabilities: v.optional(
      v.object({
        streaming: v.boolean(),
        pushNotifications: v.boolean(),
      }),
    ),

    status: v.union(
      v.literal("active"),
      v.literal("suspended"),
      v.literal("deactivated"),
    ),

    // v1 denormalized reputation — kept optional so existing rows pass validation.
    // v0.2 code never writes these. Reputation derives live from receipts.
    averageRating: v.optional(v.number()),
    totalReviews: v.optional(v.number()),
    totalJobsCompleted: v.optional(v.number()),
    totalJobsFailed: v.optional(v.number()),
    totalEarned: v.optional(v.number()),
    totalSpent: v.optional(v.number()),
  })
    .index("by_walletAddress", ["walletAddress"])
    .index("by_status", ["status"])
    .searchIndex("search_agents", {
      searchField: "description",
      filterFields: ["status", "providerType"],
    }),

  offers: defineTable({
    sellerId: v.id("agents"),
    title: v.string(),
    description: v.string(),
    category: v.string(),
    tags: v.array(v.string()),
    priceCents: v.number(),

    offerType: v.union(v.literal("api"), v.literal("download")),

    endpoint: v.optional(v.string()),
    httpMethod: v.optional(v.string()),
    inputSchema: v.optional(v.string()),
    outputSchema: v.optional(v.string()),
    estimatedDurationSeconds: v.optional(v.number()),

    // PayanAgent-operated offers (e.g. Labs). When set, the buy flow runs this
    // handler server-side after settlement instead of proxying to `endpoint`.
    // Format "<group>:<tool>", e.g. "labs:search". Never exposed publicly.
    internalHandler: v.optional(v.string()),

    fileUrl: v.optional(v.string()),
    previewDescription: v.optional(v.string()),

    isActive: v.boolean(),
  })
    .index("by_sellerId", ["sellerId", "isActive"])
    .index("by_category", ["category", "isActive"])
    .index("by_offerType", ["offerType", "isActive"])
    .searchIndex("search_offers", {
      searchField: "description",
      filterFields: ["category", "isActive", "offerType"],
    }),

  requests: defineTable({
    buyerId: v.id("agents"),
    providerId: v.optional(v.id("agents")),

    title: v.string(),
    description: v.string(),

    budgetMaxCents: v.number(),
    agreedPriceCents: v.optional(v.number()),
    // The amount actually escrowed on-chain at deposit time (so refunds/surplus
    // are computed against what was really collected, not re-derived).
    escrowDepositedCents: v.optional(v.number()),

    inputPayload: v.optional(v.string()),
    outputPayload: v.optional(v.string()),

    escrow: v.boolean(),
    escrowReceiptId: v.optional(v.id("receipts")),
    settlementReceiptId: v.optional(v.id("receipts")),

    // Status the request was in before a settlement claim (used to revert the
    // `completing` lock if the on-chain transfer fails).
    lockedFromStatus: v.optional(v.string()),

    status: v.union(
      v.literal("open"),
      v.literal("accepted"),
      v.literal("fulfilled"),
      // `completing` is an atomic lock acquired BEFORE an on-chain escrow
      // transfer so concurrent approve/cancel can't double-spend the wallet.
      v.literal("completing"),
      v.literal("approved"),
      v.literal("cancelled"),
      v.literal("disputed"),
    ),

    acceptedAt: v.optional(v.number()),
    fulfilledAt: v.optional(v.number()),
    approvedAt: v.optional(v.number()),
    cancelledAt: v.optional(v.number()),
    cancelReason: v.optional(v.string()),
  })
    .index("by_status", ["status"])
    .index("by_buyerId", ["buyerId", "status"])
    .index("by_providerId", ["providerId", "status"])
    .index("by_status_acceptedAt", ["status", "acceptedAt"])
    .searchIndex("search_requests", {
      searchField: "description",
      filterFields: ["status"],
    }),

  receipts: defineTable({
    buyerId: v.id("agents"),
    sellerId: v.id("agents"),

    offerId: v.optional(v.id("offers")),
    requestId: v.optional(v.id("requests")),
    // Set when this receipt is a buy routed through PayanAgent to an EXTERNAL
    // x402 resource (aggregator proxy-buy). Non-custodial: buyer paid the
    // external seller directly; we recorded the receipt.
    externalResourceId: v.optional(v.id("externalResources")),

    amountCents: v.number(),
    // Exact value in USDC base units (6 decimals = millionths of a dollar), so
    // sub-cent buys carry real value even when amountCents rounds to 0. Optional:
    // legacy/internal receipts fall back to amountCents*10000.
    amountMicroUsd: v.optional(v.number()),
    currency: v.string(),

    chain: v.string(),
    network: v.string(),
    txHash: v.string(),
    facilitatorUrl: v.optional(v.string()),

    settlementType: v.union(
      v.literal("direct"),
      v.literal("escrow_deposit"),
      v.literal("escrow_release"),
      v.literal("escrow_refund"),
      // Buy routed through PayanAgent to an external x402 resource.
      v.literal("external"),
    ),

    status: v.union(v.literal("confirmed"), v.literal("failed")),

    // Whether the service actually DELIVERED after payment settled — distinct
    // from `status` (which only attests the on-chain payment). Drives the
    // honest success-rate in reputation. Undefined = not yet recorded.
    delivered: v.optional(v.boolean()),
    deliveryStatus: v.optional(v.string()),

    latencyMs: v.optional(v.number()),

    signature: v.string(),

    emittedAt: v.number(),
  })
    .index("by_buyerId", ["buyerId", "emittedAt"])
    .index("by_sellerId", ["sellerId", "emittedAt"])
    .index("by_offerId", ["offerId"])
    .index("by_requestId", ["requestId"])
    .index("by_externalResourceId", ["externalResourceId", "emittedAt"])
    .index("by_emittedAt", ["emittedAt"])
    .index("by_settlementType", ["settlementType", "emittedAt"]),

  // External x402 resources discovered across the ecosystem (CDP Bazaar today),
  // mirrored so they are discoverable — and buyable — *through* PayanAgent. We
  // never custody: the stored payTo stays the external seller's wallet; the
  // proxy-buy path forwards their 402 and records a receipt. Keyed by `resource`
  // (the canonical URL) for idempotent re-ingestion.
  externalResources: defineTable({
    source: v.string(), // "bazaar"
    resource: v.string(), // canonical external URL (unique key)
    serviceName: v.optional(v.string()),
    description: v.string(),
    tags: v.array(v.string()),
    category: v.string(),
    type: v.optional(v.string()), // "http"
    iconUrl: v.optional(v.string()),

    // Chosen payment terms (prefer Base-mainnet USDC `exact`). Raw atomic amount
    // is authoritative; priceUsd is a display convenience (USDC = 6 decimals).
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
    firstSeenAt: v.number(),
    lastSeenAt: v.number(),
    status: v.union(v.literal("active"), v.literal("stale")),
  })
    .index("by_resource", ["resource"])
    .index("by_status", ["status", "lastSeenAt"])
    .index("by_network", ["network", "status"])
    .index("by_category", ["category", "status"])
    .searchIndex("search_external", {
      searchField: "description",
      filterFields: ["status", "network", "category"],
    }),

  // Bids on open requests.
  bids: defineTable({
    requestId: v.id("requests"),
    bidderId: v.id("agents"),
    priceCents: v.number(),
    estimatedDurationSeconds: v.optional(v.number()),
    message: v.optional(v.string()),
    status: v.union(
      v.literal("pending"),
      v.literal("accepted"),
      v.literal("rejected"),
      v.literal("withdrawn"),
    ),
  })
    .index("by_requestId", ["requestId", "status"])
    .index("by_bidderId", ["bidderId", "status"]),

  apiKeys: defineTable({
    agentId: v.id("agents"),
    keyHash: v.string(),
    keyPrefix: v.string(),
    label: v.optional(v.string()),
    isActive: v.boolean(),
    lastUsedAt: v.optional(v.number()),
  })
    .index("by_keyHash", ["keyHash"])
    .index("by_agentId", ["agentId"])
    .index("by_keyPrefix", ["keyPrefix", "isActive"]),

  // (v1 legacy tables dropped at cut-over.)
});
