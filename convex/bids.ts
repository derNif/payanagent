import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";

export const create = mutation({
  args: {
    jobId: v.id("jobs"),
    agentId: v.id("agents"),
    priceCents: v.number(),
    estimatedDurationSeconds: v.optional(v.number()),
    message: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job) throw new Error("Job not found");
    if (job.status !== "open") throw new Error("Job is not open for bids");
    if (job.jobType !== "open") throw new Error("Cannot bid on direct jobs");

    // Check agent isn't the client
    if (args.agentId === job.clientAgentId) {
      throw new Error("Cannot bid on your own job");
    }

    const agent = await ctx.db.get(args.agentId);
    if (!agent || agent.status !== "active") {
      throw new Error("Agent not found or inactive");
    }

    // Check for existing bid from this agent
    const existing = await ctx.db
      .query("bids")
      .withIndex("by_agentId", (q) =>
        q.eq("agentId", args.agentId).eq("status", "pending")
      )
      .filter((f) => f.eq(f.field("jobId"), args.jobId))
      .first();

    if (existing) throw new Error("You already have a pending bid on this job");

    // Check budget
    if (job.budgetMaxCents && args.priceCents > job.budgetMaxCents) {
      throw new Error("Bid exceeds job budget");
    }

    const bidId = await ctx.db.insert("bids", {
      jobId: args.jobId,
      agentId: args.agentId,
      priceCents: args.priceCents,
      estimatedDurationSeconds: args.estimatedDurationSeconds,
      message: args.message,
      status: "pending",
    });

    // bid.received -> job's client
    await ctx.scheduler.runAfter(0, internal.webhookSender.sendWebhooks, {
      event: "bid.received",
      recipientAgentIds: [job.clientAgentId],
      jobId: args.jobId,
      data: {
        bidId,
        jobId: args.jobId,
        agentId: args.agentId,
        priceCents: args.priceCents,
        estimatedDurationSeconds: args.estimatedDurationSeconds,
      },
    });

    return bidId;
  },
});

export const listByJob = query({
  args: { jobId: v.id("jobs") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("bids")
      .withIndex("by_jobId", (q) => q.eq("jobId", args.jobId))
      .collect();
  },
});

export const listByAgent = query({
  args: { agentId: v.id("agents") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("bids")
      .withIndex("by_agentId", (q) => q.eq("agentId", args.agentId))
      .collect();
  },
});

export const getById = query({
  args: { bidId: v.id("bids") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.bidId);
  },
});

export const accept = mutation({
  args: { bidId: v.id("bids") },
  handler: async (ctx, args) => {
    const bid = await ctx.db.get(args.bidId);
    if (!bid) throw new Error("Bid not found");
    if (bid.status !== "pending") throw new Error("Bid is not pending");

    // Accept this bid
    await ctx.db.patch(args.bidId, { status: "accepted" });

    // Reject all other pending bids for this job
    const otherBids = await ctx.db
      .query("bids")
      .withIndex("by_jobId", (q) =>
        q.eq("jobId", bid.jobId).eq("status", "pending")
      )
      .collect();

    for (const other of otherBids) {
      if (other._id !== args.bidId) {
        await ctx.db.patch(other._id, { status: "rejected" });
      }
    }

    // Update the job with provider and agreed price
    await ctx.db.patch(bid.jobId, {
      providerAgentId: bid.agentId,
      agreedPriceCents: bid.priceCents,
      status: "accepted",
      acceptedAt: Date.now(),
    });

    // bid.accepted -> winning bidder (provider)
    await ctx.scheduler.runAfter(0, internal.webhookSender.sendWebhooks, {
      event: "bid.accepted",
      recipientAgentIds: [bid.agentId],
      jobId: bid.jobId,
      data: {
        bidId: args.bidId,
        jobId: bid.jobId,
        agentId: bid.agentId,
        priceCents: bid.priceCents,
      },
    });

    return bid;
  },
});

export const withdraw = mutation({
  args: { bidId: v.id("bids") },
  handler: async (ctx, args) => {
    const bid = await ctx.db.get(args.bidId);
    if (!bid) throw new Error("Bid not found");
    if (bid.status !== "pending") throw new Error("Bid is not pending");
    await ctx.db.patch(args.bidId, { status: "withdrawn" });
  },
});
