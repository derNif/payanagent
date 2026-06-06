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

  // ============================================================
  // v1 LEGACY — dropped during Step 10 cut-over. v0.2 code MUST NOT write here.
  // Definitions preserved so existing rows pass validation during the build.
  // ============================================================

  services: defineTable({
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
      v.literal("hourly"),
    ),
    priceInCents: v.number(),
    endpoint: v.optional(v.string()),
    httpMethod: v.optional(v.string()),
    inputSchema: v.optional(v.string()),
    outputSchema: v.optional(v.string()),
    maxInputTokens: v.optional(v.number()),
    estimatedDurationSeconds: v.optional(v.number()),
    isActive: v.boolean(),
  })
    .index("by_agentId", ["agentId"])
    .index("by_category", ["category", "isActive"])
    .index("by_serviceType", ["serviceType", "isActive"])
    .searchIndex("search_services", {
      searchField: "description",
      filterFields: ["category", "isActive", "serviceType"],
    }),

  jobs: defineTable({
    clientAgentId: v.id("agents"),
    providerAgentId: v.optional(v.id("agents")),
    serviceId: v.optional(v.id("services")),
    title: v.string(),
    description: v.string(),
    inputPayload: v.optional(v.string()),
    outputPayload: v.optional(v.string()),
    agreedPriceCents: v.optional(v.number()),
    budgetMaxCents: v.optional(v.number()),
    jobType: v.union(v.literal("direct"), v.literal("open")),
    status: v.union(
      v.literal("open"),
      v.literal("accepted"),
      v.literal("in_progress"),
      v.literal("delivered"),
      v.literal("completing"),
      v.literal("completed"),
      v.literal("disputed"),
      v.literal("cancelling"),
      v.literal("cancelled"),
      v.literal("timingOut"),
      v.literal("failed"),
    ),
    acceptedAt: v.optional(v.number()),
    deliveredAt: v.optional(v.number()),
    completedAt: v.optional(v.number()),
    disputedAt: v.optional(v.number()),
    cancelledAt: v.optional(v.number()),
    timedOutAt: v.optional(v.number()),
    escrowTransactionId: v.optional(v.id("transactions")),
    settlementTransactionId: v.optional(v.id("transactions")),
    disputeReason: v.optional(v.string()),
    disputeResolutionNote: v.optional(v.string()),
    disputeResolvedAt: v.optional(v.number()),
    failureReason: v.optional(
      v.union(
        v.literal("timeout"),
        v.literal("dispute_refund"),
        v.literal("cancelled_by_client"),
      ),
    ),
  })
    .index("by_status_acceptedAt", ["status", "acceptedAt"])
    .index("by_clientAgentId", ["clientAgentId", "status"])
    .index("by_providerAgentId", ["providerAgentId", "status"])
    .index("by_status", ["status"])
    .index("by_jobType_status", ["jobType", "status"]),

  // v1 bids (on legacy jobs). The new v0.2 bids live on the requests table.
  // Kept here to satisfy historic rows.
  bids: defineTable({
    // v1 fields
    jobId: v.optional(v.id("jobs")),
    agentId: v.optional(v.id("agents")),
    // v0.2 fields
    requestId: v.optional(v.id("requests")),
    bidderId: v.optional(v.id("agents")),
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
    .index("by_jobId", ["jobId", "status"])
    .index("by_agentId", ["agentId", "status"])
    .index("by_requestId", ["requestId", "status"])
    .index("by_bidderId", ["bidderId", "status"]),

  transactions: defineTable({
    fromAgentId: v.id("agents"),
    toAgentId: v.optional(v.id("agents")),
    jobId: v.optional(v.id("jobs")),
    productId: v.optional(v.id("products")),
    amountCents: v.number(),
    currency: v.string(),
    chain: v.string(),
    network: v.string(),
    txHash: v.optional(v.string()),
    facilitatorUrl: v.string(),
    type: v.union(
      v.literal("escrow_deposit"),
      v.literal("escrow_release"),
      v.literal("direct_payment"),
      v.literal("refund"),
      v.literal("platform_fee"),
    ),
    status: v.union(
      v.literal("pending"),
      v.literal("confirmed"),
      v.literal("failed"),
      v.literal("refunded"),
    ),
    confirmedAt: v.optional(v.number()),
  })
    .index("by_fromAgentId", ["fromAgentId"])
    .index("by_toAgentId", ["toAgentId"])
    .index("by_jobId", ["jobId"])
    .index("by_type_status", ["type", "status"]),

  reviews: defineTable({
    jobId: v.id("jobs"),
    reviewerAgentId: v.id("agents"),
    revieweeAgentId: v.id("agents"),
    rating: v.number(),
    comment: v.optional(v.string()),
  })
    .index("by_jobId", ["jobId"])
    .index("by_revieweeAgentId", ["revieweeAgentId"])
    .index("by_reviewerAgentId", ["reviewerAgentId"]),

  webhooks: defineTable({
    agentId: v.id("agents"),
    url: v.string(),
    events: v.array(v.string()),
    secret: v.string(),
    isActive: v.boolean(),
  })
    .index("by_agentId", ["agentId"])
    .index("by_event", ["isActive"]),

  products: defineTable({
    sellerId: v.id("agents"),
    title: v.string(),
    description: v.string(),
    category: v.string(),
    tags: v.array(v.string()),
    priceCents: v.number(),
    deliveryMode: v.literal("instant"),
    fileUrl: v.string(),
    previewDescription: v.optional(v.string()),
    isActive: v.boolean(),
    reviewsCount: v.number(),
    rating: v.number(),
    createdAt: v.number(),
  })
    .index("by_sellerId", ["sellerId"])
    .index("by_category_active", ["category", "isActive"])
    .index("by_active_created", ["isActive", "createdAt"])
    .searchIndex("search_products", {
      searchField: "description",
      filterFields: ["category", "isActive"],
    }),

  productPurchases: defineTable({
    productId: v.id("products"),
    buyerId: v.id("agents"),
    transactionId: v.id("transactions"),
    downloadToken: v.string(),
    tokenExpiresAt: v.number(),
    downloadedAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_token", ["downloadToken"])
    .index("by_buyerId", ["buyerId"])
    .index("by_productId", ["productId"]),

  webhookDeliveries: defineTable({
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
  })
    .index("by_webhookId", ["webhookId"])
    .index("by_jobId", ["jobId"])
    .index("by_event_success", ["event", "success"]),
});
