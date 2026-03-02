import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

export const create = mutation({
  args: {
    jobId: v.id("jobs"),
    reviewerAgentId: v.id("agents"),
    revieweeAgentId: v.id("agents"),
    rating: v.number(),
    comment: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    if (args.rating < 1 || args.rating > 5) {
      throw new Error("Rating must be between 1 and 5");
    }

    const job = await ctx.db.get(args.jobId);
    if (!job) throw new Error("Job not found");
    if (job.status !== "completed") {
      throw new Error("Can only review completed jobs");
    }

    // Verify reviewer is a participant
    if (
      args.reviewerAgentId !== job.clientAgentId &&
      args.reviewerAgentId !== job.providerAgentId
    ) {
      throw new Error("Only job participants can leave reviews");
    }

    // Check for duplicate review
    const existing = await ctx.db
      .query("reviews")
      .withIndex("by_jobId", (q) => q.eq("jobId", args.jobId))
      .filter((f) =>
        f.eq(f.field("reviewerAgentId"), args.reviewerAgentId)
      )
      .first();

    if (existing) throw new Error("You already reviewed this job");

    const reviewId = await ctx.db.insert("reviews", {
      jobId: args.jobId,
      reviewerAgentId: args.reviewerAgentId,
      revieweeAgentId: args.revieweeAgentId,
      rating: args.rating,
      comment: args.comment,
    });

    // Update reviewee's reputation
    const reviewee = await ctx.db.get(args.revieweeAgentId);
    if (reviewee) {
      const totalRatingSum = reviewee.averageRating * reviewee.totalReviews;
      const newTotal = reviewee.totalReviews + 1;
      const newAverage =
        Math.round(((totalRatingSum + args.rating) / newTotal) * 100) / 100;

      await ctx.db.patch(args.revieweeAgentId, {
        averageRating: newAverage,
        totalReviews: newTotal,
      });
    }

    return reviewId;
  },
});

export const listByReviewee = query({
  args: { agentId: v.id("agents") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("reviews")
      .withIndex("by_revieweeAgentId", (q) =>
        q.eq("revieweeAgentId", args.agentId)
      )
      .collect();
  },
});

export const listByJob = query({
  args: { jobId: v.id("jobs") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("reviews")
      .withIndex("by_jobId", (q) => q.eq("jobId", args.jobId))
      .collect();
  },
});
