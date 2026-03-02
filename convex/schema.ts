import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  // Registered entities: AI agents, SaaS companies, API providers
  agents: defineTable({
    name: v.string(),
    description: v.string(),
    walletAddress: v.string(),
    chain: v.string(), // "base" | "base-sepolia"
    tags: v.array(v.string()),
    providerType: v.union(
      v.literal("agent"),
      v.literal("saas"),
      v.literal("api")
    ),
    agentUrl: v.optional(v.string()),
    ownerEmail: v.optional(v.string()),

    // A2A discovery
    a2aCapabilities: v.optional(
      v.object({
        streaming: v.boolean(),
        pushNotifications: v.boolean(),
      })
    ),

    // Reputation (denormalized for fast reads)
    averageRating: v.number(),
    totalReviews: v.number(),
    totalJobsCompleted: v.number(),
    totalJobsFailed: v.number(),
    totalEarned: v.number(), // cents
    totalSpent: v.number(), // cents

    status: v.union(
      v.literal("active"),
      v.literal("suspended"),
      v.literal("deactivated")
    ),
  })
    .index("by_walletAddress", ["walletAddress"])
    .index("by_status", ["status"])
    .index("by_rating", ["averageRating"])
    .searchIndex("search_agents", {
      searchField: "description",
      filterFields: ["status", "providerType"],
    }),

  // Capabilities that agents/providers offer
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
      v.literal("hourly")
    ),
    priceInCents: v.number(),

    // For API-type services (registry mode)
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

  // Work requests between agents
  jobs: defineTable({
    clientAgentId: v.id("agents"),
    providerAgentId: v.optional(v.id("agents")), // null if open job
    serviceId: v.optional(v.id("services")),
    title: v.string(),
    description: v.string(),
    inputPayload: v.optional(v.string()),
    outputPayload: v.optional(v.string()),

    agreedPriceCents: v.optional(v.number()),
    budgetMaxCents: v.optional(v.number()), // for open jobs

    jobType: v.union(v.literal("direct"), v.literal("open")),
    status: v.union(
      v.literal("open"),
      v.literal("accepted"),
      v.literal("in_progress"),
      v.literal("delivered"),
      v.literal("completed"),
      v.literal("disputed"),
      v.literal("cancelled"),
      v.literal("failed")
    ),

    acceptedAt: v.optional(v.number()),
    deliveredAt: v.optional(v.number()),
    completedAt: v.optional(v.number()),
    disputedAt: v.optional(v.number()),
    cancelledAt: v.optional(v.number()),

    escrowTransactionId: v.optional(v.id("transactions")),
    settlementTransactionId: v.optional(v.id("transactions")),

    disputeReason: v.optional(v.string()),
  })
    .index("by_clientAgentId", ["clientAgentId", "status"])
    .index("by_providerAgentId", ["providerAgentId", "status"])
    .index("by_status", ["status"])
    .index("by_jobType_status", ["jobType", "status"]),

  // Bids on open jobs
  bids: defineTable({
    jobId: v.id("jobs"),
    agentId: v.id("agents"),
    priceCents: v.number(),
    estimatedDurationSeconds: v.optional(v.number()),
    message: v.optional(v.string()),
    status: v.union(
      v.literal("pending"),
      v.literal("accepted"),
      v.literal("rejected"),
      v.literal("withdrawn")
    ),
  })
    .index("by_jobId", ["jobId", "status"])
    .index("by_agentId", ["agentId", "status"]),

  // x402 payment records
  transactions: defineTable({
    fromAgentId: v.id("agents"),
    toAgentId: v.optional(v.id("agents")),
    jobId: v.optional(v.id("jobs")),
    amountCents: v.number(),
    currency: v.string(),
    chain: v.string(),
    network: v.string(), // CAIP-2: "eip155:84532"
    txHash: v.optional(v.string()),
    facilitatorUrl: v.string(),
    type: v.union(
      v.literal("escrow_deposit"),
      v.literal("escrow_release"),
      v.literal("direct_payment"),
      v.literal("refund"),
      v.literal("platform_fee")
    ),
    status: v.union(
      v.literal("pending"),
      v.literal("confirmed"),
      v.literal("failed"),
      v.literal("refunded")
    ),
    confirmedAt: v.optional(v.number()),
  })
    .index("by_fromAgentId", ["fromAgentId"])
    .index("by_toAgentId", ["toAgentId"])
    .index("by_jobId", ["jobId"])
    .index("by_type_status", ["type", "status"]),

  // Ratings after job completion
  reviews: defineTable({
    jobId: v.id("jobs"),
    reviewerAgentId: v.id("agents"),
    revieweeAgentId: v.id("agents"),
    rating: v.number(), // 1-5
    comment: v.optional(v.string()),
  })
    .index("by_jobId", ["jobId"])
    .index("by_revieweeAgentId", ["revieweeAgentId"])
    .index("by_reviewerAgentId", ["reviewerAgentId"]),

  // Agent authentication tokens
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

  // Webhook subscriptions for event notifications
  webhooks: defineTable({
    agentId: v.id("agents"),
    url: v.string(),
    events: v.array(v.string()),
    secret: v.string(),
    isActive: v.boolean(),
  })
    .index("by_agentId", ["agentId"])
    .index("by_event", ["isActive"]),
});
