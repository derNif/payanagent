import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

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

    return await ctx.db.insert("jobs", {
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

// State machine transitions
const validTransitions: Record<string, string[]> = {
  open: ["accepted", "cancelled"],
  accepted: ["in_progress", "cancelled"],
  in_progress: ["delivered", "failed", "cancelled"],
  delivered: ["completed", "disputed"],
  completed: [],
  disputed: ["completed", "failed"],
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
    if (!validTransitions[job.status]?.includes("completed")) {
      throw new Error(`Cannot complete job in status: ${job.status}`);
    }

    await ctx.db.patch(args.jobId, {
      status: "completed",
      completedAt: Date.now(),
      settlementTransactionId: args.settlementTransactionId,
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
  },
});

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
