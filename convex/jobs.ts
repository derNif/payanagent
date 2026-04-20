import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";

export const create = mutation({
  args: {
    clientAgentId: v.id("agents"),
    providerAgentId: v.optional(v.id("agents")),
    serviceId: v.optional(v.id("services")),
    title: v.string(),
    description: v.string(),
    inputPayload: v.optional(v.string()),
    agreedPriceCents: v.optional(v.number()),
    budgetMaxCents: v.optional(v.number()),
    jobType: v.union(v.literal("direct"), v.literal("open")),
    escrowTransactionId: v.optional(v.id("transactions")),
  },
  handler: async (ctx, args) => {
    const client = await ctx.db.get(args.clientAgentId);
    if (!client || client.status !== "active") {
      throw new Error("Client agent not found or inactive");
    }

    if (args.jobType === "direct" && !args.providerAgentId) {
      throw new Error("Direct jobs require a provider agent");
    }

    if (args.jobType === "open" && !args.budgetMaxCents) {
      throw new Error("Open jobs require a budget");
    }

    const jobId = await ctx.db.insert("jobs", {
      clientAgentId: args.clientAgentId,
      providerAgentId: args.providerAgentId,
      serviceId: args.serviceId,
      title: args.title,
      description: args.description,
      inputPayload: args.inputPayload,
      agreedPriceCents: args.agreedPriceCents,
      budgetMaxCents: args.budgetMaxCents,
      jobType: args.jobType,
      status: args.jobType === "open" ? "open" : "open",
      escrowTransactionId: args.escrowTransactionId,
    });

    // job.received: only meaningful for direct jobs (an open job has no addressed provider)
    if (args.jobType === "direct" && args.providerAgentId) {
      await ctx.scheduler.runAfter(0, internal.webhookSender.sendWebhooks, {
        event: "job.received",
        recipientAgentIds: [args.providerAgentId],
        jobId,
        data: {
          jobId,
          clientAgentId: args.clientAgentId,
          providerAgentId: args.providerAgentId,
          title: args.title,
          agreedPriceCents: args.agreedPriceCents,
          jobType: "direct",
        },
      });
    }

    return jobId;
  },
});

export const getById = query({
  args: { jobId: v.id("jobs") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.jobId);
  },
});

export const listByClient = query({
  args: {
    clientAgentId: v.id("agents"),
    status: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    let q = ctx.db
      .query("jobs")
      .withIndex("by_clientAgentId", (q) =>
        q.eq("clientAgentId", args.clientAgentId)
      );

    if (args.status) {
      q = q.filter((f) => f.eq(f.field("status"), args.status));
    }

    return await q.collect();
  },
});

export const listByProvider = query({
  args: {
    providerAgentId: v.id("agents"),
    status: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    let q = ctx.db
      .query("jobs")
      .withIndex("by_providerAgentId", (q) =>
        q.eq("providerAgentId", args.providerAgentId)
      );

    if (args.status) {
      q = q.filter((f) => f.eq(f.field("status"), args.status));
    }

    return await q.collect();
  },
});

export const listOpen = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db
      .query("jobs")
      .withIndex("by_jobType_status", (q) =>
        q.eq("jobType", "open").eq("status", "open")
      )
      .collect();
  },
});

export const listAll = query({
  args: {
    status: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    if (args.status) {
      return await ctx.db
        .query("jobs")
        .withIndex("by_status", (q) => q.eq("status", args.status as "open"))
        .collect();
    }
    return await ctx.db.query("jobs").collect();
  },
});

// State machine transitions.
// Notes:
//  - `accepted` always has escrow (bid-accept paid or direct-hire paid). The
//    normal client cancel path routes through `cancelling`, so the refund is
//    gated by the atomic lock.
//  - `open` direct-hire jobs also have escrow; `open` marketplace jobs don't.
//    The API route decides which path to take; both transitions are permitted.
//  - Direct `*→cancelled` transitions (`open→cancelled`, `accepted→cancelled`,
//    `in_progress→cancelled`) are admin-only state-recovery escape hatches for
//    when the normal cancel path fails (e.g. stuck `cancelling` lock, on-chain
//    refund executed out-of-band). They bypass the atomic lock AND the refund
//    flow — whoever calls them is responsible for the USDC. Only callable from
//    the admin dashboard's `cancel` mutation, which itself is admin-gated.
const validTransitions: Record<string, string[]> = {
  open: ["accepted", "cancelling", "cancelled"],
  accepted: ["in_progress", "cancelling", "cancelled", "timingOut"],
  in_progress: ["delivered", "failed", "cancelled"],
  delivered: ["completing", "disputed"],
  completing: ["completed", "delivered", "disputed"],
  completed: [],
  disputed: ["completing", "cancelling", "completed", "failed"],
  cancelling: ["cancelled", "open", "accepted", "disputed"],
  timingOut: ["failed", "accepted"],
  cancelled: [],
  failed: [],
};

export const accept = mutation({
  args: {
    jobId: v.id("jobs"),
    providerAgentId: v.id("agents"),
  },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job) throw new Error("Job not found");
    if (!validTransitions[job.status]?.includes("accepted")) {
      throw new Error(`Cannot accept job in status: ${job.status}`);
    }

    await ctx.db.patch(args.jobId, {
      status: "accepted",
      providerAgentId: args.providerAgentId,
      acceptedAt: Date.now(),
    });
  },
});

export const startWork = mutation({
  args: { jobId: v.id("jobs") },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job) throw new Error("Job not found");
    if (!validTransitions[job.status]?.includes("in_progress")) {
      throw new Error(`Cannot start work on job in status: ${job.status}`);
    }

    await ctx.db.patch(args.jobId, { status: "in_progress" });
  },
});

export const deliver = mutation({
  args: {
    jobId: v.id("jobs"),
    outputPayload: v.string(),
  },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job) throw new Error("Job not found");
    if (!validTransitions[job.status]?.includes("delivered")) {
      throw new Error(`Cannot deliver job in status: ${job.status}`);
    }

    await ctx.db.patch(args.jobId, {
      status: "delivered",
      outputPayload: args.outputPayload,
      deliveredAt: Date.now(),
    });

    // job.delivered -> client
    await ctx.scheduler.runAfter(0, internal.webhookSender.sendWebhooks, {
      event: "job.delivered",
      recipientAgentIds: [job.clientAgentId],
      jobId: args.jobId,
      data: {
        jobId: args.jobId,
        clientAgentId: job.clientAgentId,
        providerAgentId: job.providerAgentId,
        agreedPriceCents: job.agreedPriceCents,
        deliveredAt: Date.now(),
      },
    });
  },
});

// Atomically lock job for completion (prevents double-spend)
export const markCompleting = mutation({
  args: { jobId: v.id("jobs") },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job) throw new Error("Job not found");
    if (!validTransitions[job.status]?.includes("completing")) {
      throw new Error(`Cannot begin completion for job in status: ${job.status}`);
    }
    await ctx.db.patch(args.jobId, { status: "completing" });
  },
});

// Revert from completing back to delivered (on escrow failure)
export const revertToDelivered = mutation({
  args: { jobId: v.id("jobs") },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job) throw new Error("Job not found");
    if (job.status !== "completing") {
      throw new Error(`Cannot revert job in status: ${job.status}`);
    }
    await ctx.db.patch(args.jobId, { status: "delivered" });
  },
});

// Atomically lock job for cancellation (prevents double-refund).
// Only callable while status ∈ {open, accepted}.
export const markCancelling = mutation({
  args: { jobId: v.id("jobs") },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job) throw new Error("Job not found");
    if (!validTransitions[job.status]?.includes("cancelling")) {
      throw new Error(`Cannot begin cancellation for job in status: ${job.status}`);
    }
    await ctx.db.patch(args.jobId, { status: "cancelling" });
  },
});

// Revert from cancelling back to previous status (on refund failure).
// Caller specifies which status to revert to (must be open or accepted).
export const revertFromCancelling = mutation({
  args: {
    jobId: v.id("jobs"),
    toStatus: v.union(v.literal("open"), v.literal("accepted")),
  },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job) throw new Error("Job not found");
    if (job.status !== "cancelling") {
      throw new Error(`Cannot revert job in status: ${job.status}`);
    }
    await ctx.db.patch(args.jobId, { status: args.toStatus });
  },
});

// Revert from an in-flight dispute-resolution lock back to disputed (on on-chain failure).
// Used by admin /dispute/resolve when releaseEscrow fails after the lock has been taken.
export const revertToDisputed = mutation({
  args: { jobId: v.id("jobs") },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job) throw new Error("Job not found");
    if (job.status !== "completing" && job.status !== "cancelling") {
      throw new Error(`Cannot revert job in status: ${job.status}`);
    }
    await ctx.db.patch(args.jobId, { status: "disputed" });
  },
});

// Record the Board's dispute-resolution note on the job row.
// Called by the admin /dispute/resolve route after on-chain success, before
// the terminal jobs.complete / jobs.cancel mutation fires the webhook — so
// subscribers that read the job row after receiving the event see the note.
// Only valid during the resolve atomic window (status === completing | cancelling).
export const recordDisputeResolution = mutation({
  args: {
    jobId: v.id("jobs"),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job) throw new Error("Job not found");
    if (job.status !== "completing" && job.status !== "cancelling") {
      throw new Error(
        `recordDisputeResolution requires the resolve lock; got: ${job.status}`
      );
    }
    await ctx.db.patch(args.jobId, {
      disputeResolutionNote: args.note,
      disputeResolvedAt: Date.now(),
    });
  },
});

export const complete = mutation({
  args: {
    jobId: v.id("jobs"),
    settlementTransactionId: v.optional(v.id("transactions")),
  },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job) throw new Error("Job not found");
    // Allow completing→completed (normal flow) or delivered→completed (legacy)
    if (job.status !== "completing" && !validTransitions[job.status]?.includes("completed")) {
      throw new Error(`Cannot complete job in status: ${job.status}`);
    }

    await ctx.db.patch(args.jobId, {
      status: "completed",
      completedAt: Date.now(),
      settlementTransactionId: args.settlementTransactionId,
    });

    // job.completed -> both parties
    const recipients = [job.clientAgentId];
    if (job.providerAgentId) recipients.push(job.providerAgentId);
    await ctx.scheduler.runAfter(0, internal.webhookSender.sendWebhooks, {
      event: "job.completed",
      recipientAgentIds: recipients,
      jobId: args.jobId,
      data: {
        jobId: args.jobId,
        clientAgentId: job.clientAgentId,
        providerAgentId: job.providerAgentId,
        agreedPriceCents: job.agreedPriceCents,
        settlementTransactionId: args.settlementTransactionId,
        completedAt: Date.now(),
      },
    });
  },
});

export const dispute = mutation({
  args: {
    jobId: v.id("jobs"),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job) throw new Error("Job not found");
    if (!validTransitions[job.status]?.includes("disputed")) {
      throw new Error(`Cannot dispute job in status: ${job.status}`);
    }

    await ctx.db.patch(args.jobId, {
      status: "disputed",
      disputeReason: args.reason,
      disputedAt: Date.now(),
    });

    // job.disputed -> both parties
    const recipients = [job.clientAgentId];
    if (job.providerAgentId) recipients.push(job.providerAgentId);
    await ctx.scheduler.runAfter(0, internal.webhookSender.sendWebhooks, {
      event: "job.disputed",
      recipientAgentIds: recipients,
      jobId: args.jobId,
      data: {
        jobId: args.jobId,
        clientAgentId: job.clientAgentId,
        providerAgentId: job.providerAgentId,
        reason: args.reason,
        disputedAt: Date.now(),
      },
    });
  },
});

// Admin-only state-recovery escape hatch. Marks a job as cancelled without
// routing through the `cancelling` atomic lock and without triggering a refund.
// Use only when the normal client cancel path fails and the on-chain refund (if
// any) is being handled out-of-band. Callable from the admin dashboard only.
export const cancel = mutation({
  args: { jobId: v.id("jobs") },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job) throw new Error("Job not found");
    if (!validTransitions[job.status]?.includes("cancelled")) {
      throw new Error(`Cannot cancel job in status: ${job.status}`);
    }

    await ctx.db.patch(args.jobId, {
      status: "cancelled",
      cancelledAt: Date.now(),
    });

    // job.cancelled -> both parties (provider may be null for unaccepted open jobs)
    const recipients = [job.clientAgentId];
    if (job.providerAgentId) recipients.push(job.providerAgentId);
    await ctx.scheduler.runAfter(0, internal.webhookSender.sendWebhooks, {
      event: "job.cancelled",
      recipientAgentIds: recipients,
      jobId: args.jobId,
      data: {
        jobId: args.jobId,
        clientAgentId: job.clientAgentId,
        providerAgentId: job.providerAgentId,
        agreedPriceCents: job.agreedPriceCents,
        cancelledAt: Date.now(),
      },
    });
  },
});

// Atomically lock an `accepted` job for timeout processing. Callable from both
// the cron sweep (14-day threshold) and the admin force-timeout route (manual
// override, no threshold). Only callable while status === "accepted".
export const markTimingOut = mutation({
  args: { jobId: v.id("jobs") },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job) throw new Error("Job not found");
    if (!validTransitions[job.status]?.includes("timingOut")) {
      throw new Error(`Cannot begin timeout for job in status: ${job.status}`);
    }
    await ctx.db.patch(args.jobId, { status: "timingOut" });
  },
});

// Revert from `timingOut` back to `accepted` on on-chain refund failure.
// Chain state never changed (transfer failed pre-finalize) so the job
// rejoins the stale pool for the next cron sweep.
export const revertFromTimingOut = mutation({
  args: { jobId: v.id("jobs") },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job) throw new Error("Job not found");
    if (job.status !== "timingOut") {
      throw new Error(`Cannot revert job in status: ${job.status}`);
    }
    await ctx.db.patch(args.jobId, { status: "accepted" });
  },
});

// Finalize a timed-out job: timingOut → failed. Sets failureReason="timeout",
// stamps timedOutAt, and fires job.timed_out webhook. Caller is responsible
// for having completed the on-chain refund and recorded the transactions row
// before invoking this mutation.
export const finalizeTimeout = mutation({
  args: { jobId: v.id("jobs") },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job) throw new Error("Job not found");
    if (job.status !== "timingOut") {
      throw new Error(
        `finalizeTimeout requires the timingOut lock; got: ${job.status}`
      );
    }
    const timedOutAt = Date.now();
    await ctx.db.patch(args.jobId, {
      status: "failed",
      failureReason: "timeout",
      timedOutAt,
    });

    // job.timed_out -> both parties (provider must exist; an accepted job has one)
    const recipients = [job.clientAgentId];
    if (job.providerAgentId) recipients.push(job.providerAgentId);
    await ctx.scheduler.runAfter(0, internal.webhookSender.sendWebhooks, {
      event: "job.timed_out",
      recipientAgentIds: recipients,
      jobId: args.jobId,
      data: {
        jobId: args.jobId,
        clientAgentId: job.clientAgentId,
        providerAgentId: job.providerAgentId,
        amountCents: job.agreedPriceCents,
        acceptedAt: job.acceptedAt,
        timedOutAt,
      },
    });
  },
});

// Return ids of jobs whose `accepted` window has expired. Cron-only caller.
// Uses the by_status_acceptedAt compound index so this scales even when the
// accepted pool is large — we only scan rows with status === "accepted".
export const listStaleAccepted = query({
  args: { cutoffMs: v.number(), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 100;
    const rows = await ctx.db
      .query("jobs")
      .withIndex("by_status_acceptedAt", (q) =>
        q.eq("status", "accepted").lt("acceptedAt", args.cutoffMs)
      )
      .take(limit);
    return rows.map((row) => ({
      _id: row._id,
      clientAgentId: row.clientAgentId,
      providerAgentId: row.providerAgentId,
      agreedPriceCents: row.agreedPriceCents,
      acceptedAt: row.acceptedAt,
    }));
  },
});

export const getStats = query({
  args: {},
  handler: async (ctx) => {
    const allJobs = await ctx.db.query("jobs").collect();
    const byStatus: Record<string, number> = {};
    for (const job of allJobs) {
      byStatus[job.status] = (byStatus[job.status] || 0) + 1;
    }
    return { total: allJobs.length, byStatus };
  },
});
