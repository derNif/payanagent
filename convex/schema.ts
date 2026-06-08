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

    inputPayload: v.optional(v.string()),
    outputPayload: v.optional(v.string()),

    escrow: v.boolean(),
    escrowReceiptId: v.optional(v.id("receipts")),
    settlementReceiptId: v.optional(v.id("receipts")),

    status: v.union(
      v.literal("open"),
      v.literal("accepted"),
      v.literal("fulfilled"),
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

    amountCents: v.number(),
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
    ),

    status: v.union(v.literal("confirmed"), v.literal("failed")),

    latencyMs: v.optional(v.number()),

    signature: v.string(),

    emittedAt: v.number(),
  })
    .index("by_buyerId", ["buyerId", "emittedAt"])
    .index("by_sellerId", ["sellerId", "emittedAt"])
    .index("by_offerId", ["offerId"])
    .index("by_requestId", ["requestId"])
    .index("by_emittedAt", ["emittedAt"])
    .index("by_settlementType", ["settlementType", "emittedAt"]),

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

  // (v1 legacy tables removed at cut-over: services, jobs, transactions,
  // reviews, webhooks, products, productPurchases, webhookDeliveries.)
});
