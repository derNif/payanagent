import { z } from "zod";
import { NextResponse } from "next/server";

// Shared types
const walletAddress = z.string().regex(/^0x[a-fA-F0-9]{40}$/, "Invalid wallet address");
const tags = z.array(z.string().max(50)).max(20).default([]);

// Agent registration
export const registerAgentSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().min(1).max(2000),
  walletAddress,
  chain: z.string().max(50).default("base"),
  tags,
  providerType: z.enum(["agent", "saas", "api"]).default("agent"),
  agentUrl: z.string().url().optional(),
  ownerEmail: z.string().email().optional(),
  discoverySource: z.string().max(500).optional(),
  a2aCapabilities: z.object({ streaming: z.boolean(), pushNotifications: z.boolean() }).optional(),
});

// Agent update
export const updateAgentSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().min(1).max(2000).optional(),
  tags: tags.optional(),
  agentUrl: z.string().url().optional(),
  ownerEmail: z.string().email().optional(),
  a2aCapabilities: z.object({ streaming: z.boolean(), pushNotifications: z.boolean() }).optional(),
});

// Offer creation (v0.2)
export const createOfferSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().min(1).max(2000),
  category: z.string().min(1).max(100),
  tags: tags.optional(),
  priceCents: z.number().int().min(1).max(10_000_000),
  offerType: z.enum(["api", "download"]),
  endpoint: z.string().url().optional(),
  httpMethod: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]).optional(),
  inputSchema: z.string().optional(),
  outputSchema: z.string().optional(),
  estimatedDurationSeconds: z.number().int().positive().optional(),
  fileUrl: z.string().url().optional(),
  previewDescription: z.string().max(1000).optional(),
})
  .refine(
    (data) => data.offerType !== "api" || !!data.endpoint,
    { message: "API offers require an endpoint URL", path: ["endpoint"] },
  )
  .refine(
    (data) => data.offerType !== "download" || !!data.fileUrl,
    { message: "Download offers require a fileUrl", path: ["fileUrl"] },
  );

// Offer update (v0.2)
export const updateOfferSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().min(1).max(2000).optional(),
  category: z.string().min(1).max(100).optional(),
  tags: tags.optional(),
  priceCents: z.number().int().min(1).max(10_000_000).optional(),
  endpoint: z.string().url().optional(),
  httpMethod: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]).optional(),
  inputSchema: z.string().optional(),
  outputSchema: z.string().optional(),
  estimatedDurationSeconds: z.number().int().positive().optional(),
  fileUrl: z.string().url().optional(),
  previewDescription: z.string().max(1000).optional(),
  isActive: z.boolean().optional(),
});

// Service creation
export const createServiceSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().min(1).max(2000),
  category: z.string().min(1).max(100),
  tags,
  serviceType: z.enum(["api", "job"]).default("job"),
  pricingModel: z.enum(["per_request", "per_job", "per_token", "hourly"]),
  priceInCents: z.number().int().min(0).max(10_000_000),
  endpoint: z.string().url().optional(),
  httpMethod: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]).optional(),
  inputSchema: z.string().optional(),
  outputSchema: z.string().optional(),
  maxInputTokens: z.number().int().positive().optional(),
  estimatedDurationSeconds: z.number().int().positive().optional(),
}).refine(
  (data) => data.serviceType !== "api" || data.endpoint,
  { message: "API services require an endpoint URL", path: ["endpoint"] }
);

// Request/job creation (legacy v1 — kept for compile-time compatibility with
// any code still importing the old name. v0.2 routes use createRequestSchema
// defined below.)
export const legacyCreateRequestSchema = z.object({
  title: z.string().min(1).max(300),
  description: z.string().min(1).max(5000),
  serviceId: z.string().optional(),
  providerAgentId: z.string().optional(),
  inputPayload: z.string().optional(),
  budgetMaxCents: z.number().int().min(1).max(10_000_000).optional(),
  jobType: z.enum(["direct", "open"]).optional(),
  agreedPriceCents: z.number().int().min(1).max(10_000_000).optional(),
});

// Bid submission
export const createBidSchema = z.object({
  priceCents: z.number().int().min(1).max(10_000_000),
  estimatedDurationSeconds: z.number().int().positive().optional(),
  message: z.string().max(2000).optional(),
});

// --- v0.2 request schemas ---

// Request creation (buyer-initiated). escrow=true means an x402 payment is
// expected up-front; the route checks the payment header and emits an
// escrow_deposit receipt before the row is marked ready.
export const createRequestSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().min(1).max(5000),
  budgetMaxCents: z.number().int().min(1).max(10_000_000),
  escrow: z.boolean().default(false),
  inputPayload: z.string().max(50_000).optional(),
  providerId: z.string().optional(), // for direct-hire (will be cast to Id<"agents">)
  agreedPriceCents: z.number().int().min(1).max(10_000_000).optional(),
}).refine(
  (d) => !d.providerId || d.agreedPriceCents !== undefined,
  { message: "direct hire requires agreedPriceCents", path: ["agreedPriceCents"] },
);

export const fulfillRequestSchema = z.object({
  outputPayload: z.string().min(1, "outputPayload is required"),
});

export const acceptBidOnRequestSchema = z.object({
  bidId: z.string().min(1, "bidId is required"),
});

// Delivery
export const deliverSchema = z.object({
  outputPayload: z.string().min(1, "outputPayload is required"),
});

// Cancel
export const cancelSchema = z.object({
  reason: z.string().min(1).max(500).optional(),
});

// Dispute (either party opens a dispute on a delivered job)
export const disputeSchema = z.object({
  reason: z.string().min(1).max(2000),
});

// Admin dispute resolution
export const resolveDisputeSchema = z.object({
  resolution: z.enum(["release", "refund"]),
  note: z.string().max(2000).optional(),
});

// Admin force timeout (manual override for escrow timeout auto-refund)
export const forceTimeoutSchema = z.object({
  note: z.string().max(2000).optional(),
});

// Review
export const reviewSchema = z.object({
  rating: z.number().int().min(1).max(5),
  comment: z.string().max(2000).optional(),
});

// Product creation (seller-initiated)
export const createProductSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().min(1).max(5000),
  category: z.string().min(1).max(100),
  tags,
  priceCents: z.number().int().min(0).max(10_000_000),
  fileUrl: z.string().url(),
  previewDescription: z.string().max(500).optional(),
});

// Webhook registration
export const WEBHOOK_EVENTS = [
  "job.received",
  "bid.received",
  "bid.accepted",
  "job.delivered",
  "job.completed",
  "job.cancelled",
  "job.disputed",
  "job.timed_out",
] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

export const webhookSchema = z.object({
  url: z.string().url(),
  events: z.array(z.enum(WEBHOOK_EVENTS)).min(1),
});

// Parse and validate request body, return parsed data or error response
export async function validateBody<T>(
  request: Request,
  schema: z.ZodSchema<T>
): Promise<{ data: T; error?: never } | { data?: never; error: NextResponse }> {
  try {
    const body = await request.json();
    const result = schema.safeParse(body);
    if (!result.success) {
      const issues = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
      return {
        error: NextResponse.json(
          { error: "Validation failed", details: issues },
          { status: 400 }
        ),
      };
    }
    return { data: result.data };
  } catch {
    return {
      error: NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }),
    };
  }
}
