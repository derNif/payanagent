"use node";

import { v } from "convex/values";
import { createHmac } from "node:crypto";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

// Fire-and-forget webhook delivery for an event.
// - Looks up active webhooks subscribed to `event` for the given recipient agents.
// - POSTs JSON body with HMAC-SHA256 signature (hex) over the raw body.
// - Per delivery: 1 attempt in this action. On 5xx / network / timeout, schedule a retry
//   via `retryDelivery` with exponential backoff. Max 3 attempts total.
//
// Scheduled from mutations via: ctx.scheduler.runAfter(0, internal.webhookSender.sendWebhooks, { ... })

const MAX_ATTEMPTS = 3;
const BACKOFF_MS = [2_000, 8_000, 30_000]; // between attempts 1->2, 2->3, 3->end
const POST_TIMEOUT_MS = 5_000;
const USER_AGENT = "payanagent-webhooks/0.1";

type EventEnvelope = {
  event: string;
  jobId?: string;
  timestamp: number;
  data: Record<string, unknown>;
};

export const sendWebhooks = internalAction({
  args: {
    event: v.string(),
    recipientAgentIds: v.array(v.id("agents")),
    jobId: v.optional(v.id("jobs")),
    data: v.any(), // stringifiable payload — validated at caller, typed per-event
  },
  handler: async (
    ctx,
    args
  ): Promise<{ delivered: number; scheduled: number; targets?: number }> => {
    const targets = await ctx.runQuery(internal.webhooks.getTargetsForEvent, {
      agentIds: args.recipientAgentIds,
      event: args.event,
    });

    if (targets.length === 0) return { delivered: 0, scheduled: 0 };

    const envelope: EventEnvelope = {
      event: args.event,
      jobId: args.jobId,
      timestamp: Date.now(),
      data: args.data ?? {},
    };
    const body = JSON.stringify(envelope);

    let delivered = 0;
    let scheduled = 0;

    for (const t of targets) {
      const result = await postOnce(t.url, t.secret, args.event, body);

      await ctx.runMutation(internal.webhooks.logDelivery, {
        webhookId: t._id as Id<"webhooks">,
        agentId: t.agentId as Id<"agents">,
        url: t.url,
        event: args.event,
        jobId: args.jobId,
        attempt: 1,
        statusCode: result.statusCode,
        error: result.error,
        durationMs: result.durationMs,
        success: result.success,
      });

      if (result.success) {
        delivered++;
        continue;
      }

      if (result.retryable) {
        await ctx.scheduler.runAfter(
          BACKOFF_MS[0],
          internal.webhookSender.retryDelivery,
          {
            webhookId: t._id as Id<"webhooks">,
            agentId: t.agentId as Id<"agents">,
            event: args.event,
            jobId: args.jobId,
            body,
            attempt: 2,
          }
        );
        scheduled++;
      }
    }

    return { delivered, scheduled, targets: targets.length };
  },
});

export const retryDelivery = internalAction({
  args: {
    webhookId: v.id("webhooks"),
    agentId: v.id("agents"),
    event: v.string(),
    jobId: v.optional(v.id("jobs")),
    body: v.string(),
    attempt: v.number(),
  },
  handler: async (
    ctx,
    args
  ): Promise<
    | { skipped: true }
    | { success: boolean; attempt: number; rescheduled?: boolean; giveUp?: boolean }
  > => {
    // Re-check webhook still exists + active; secret may have rotated.
    const w = await ctx.runQuery(internal.webhooks.getSecret, {
      webhookId: args.webhookId,
    });
    if (!w || !w.isActive) return { skipped: true };

    const result = await postOnce(w.url, w.secret, args.event, args.body);

    await ctx.runMutation(internal.webhooks.logDelivery, {
      webhookId: args.webhookId,
      agentId: args.agentId,
      url: w.url,
      event: args.event,
      jobId: args.jobId,
      attempt: args.attempt,
      statusCode: result.statusCode,
      error: result.error,
      durationMs: result.durationMs,
      success: result.success,
    });

    if (result.success) return { success: true, attempt: args.attempt };

    if (result.retryable && args.attempt < MAX_ATTEMPTS) {
      const backoffIdx = Math.min(args.attempt - 1, BACKOFF_MS.length - 1);
      await ctx.scheduler.runAfter(
        BACKOFF_MS[backoffIdx],
        internal.webhookSender.retryDelivery,
        {
          webhookId: args.webhookId,
          agentId: args.agentId,
          event: args.event,
          jobId: args.jobId,
          body: args.body,
          attempt: args.attempt + 1,
        }
      );
      return { success: false, attempt: args.attempt, rescheduled: true };
    }

    return { success: false, attempt: args.attempt, giveUp: true };
  },
});

// ---------- internals ----------

type PostResult = {
  success: boolean;
  retryable: boolean;
  statusCode?: number;
  error?: string;
  durationMs: number;
};

async function postOnce(
  url: string,
  secret: string,
  event: string,
  body: string
): Promise<PostResult> {
  const signature = signBody(secret, body);
  const deliveryId = cryptoRandomId();
  const started = Date.now();

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), POST_TIMEOUT_MS);

  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": USER_AGENT,
        "X-Paya-Event": event,
        "X-Paya-Signature": `sha256=${signature}`,
        "X-Paya-Delivery-Id": deliveryId,
      },
      body,
      signal: controller.signal,
    });

    const durationMs = Date.now() - started;
    const statusCode = resp.status;

    if (statusCode >= 200 && statusCode < 300) {
      return { success: true, retryable: false, statusCode, durationMs };
    }
    // 4xx: do not retry (permanent client error, likely bad URL / wrong config)
    // 5xx: retry
    const retryable = statusCode >= 500;
    return {
      success: false,
      retryable,
      statusCode,
      error: `HTTP ${statusCode}`,
      durationMs,
    };
  } catch (err) {
    const durationMs = Date.now() - started;
    const message = err instanceof Error ? err.message : "network error";
    // Network / timeout — always retryable within attempt budget
    return {
      success: false,
      retryable: true,
      error: message,
      durationMs,
    };
  } finally {
    clearTimeout(timeout);
  }
}

function signBody(secret: string, body: string): string {
  return createHmac("sha256", secret).update(body).digest("hex");
}

function cryptoRandomId(): string {
  // Short random id for log correlation. Node's crypto.randomUUID is available.
  return crypto.randomUUID();
}
