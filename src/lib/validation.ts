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

// Request/job creation
export const createRequestSchema = z.object({
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

// Delivery
export const deliverSchema = z.object({
  outputPayload: z.string().min(1, "outputPayload is required"),
});

// Cancel
export const cancelSchema = z.object({
  reason: z.string().min(1).max(500).optional(),
});

// Review
export const reviewSchema = z.object({
  rating: z.number().int().min(1).max(5),
  comment: z.string().max(2000).optional(),
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
