import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { Doc, Id } from "./_generated/dataModel";

// Requests — bespoke work posted by buyers.
// Lifecycle:
//   open -> accepted -> fulfilled -> approved   (success path)
//   open|accepted -> cancelled                   (buyer-initiated, refund if escrow)
//   anything       -> disputed                   (rare, manual resolve)
//
// Settlement receipts are emitted at:
//   - escrow funding (on create, if escrow=true) -> escrowReceiptId
//   - approval (release to provider)             -> settlementReceiptId
//   - cancel/timeout (refund to buyer)           -> receipt with settlementType=escrow_refund

// --- creation ---

export const create = mutation({
  args: {
    buyerId: v.id("agents"),
    title: v.string(),
    description: v.string(),
    budgetMaxCents: v.number(),
    escrow: v.boolean(),
    inputPayload: v.optional(v.string()),
    providerId: v.optional(v.id("agents")), // direct hire when present
    agreedPriceCents: v.optional(v.number()), // required when providerId set
  },
  handler: async (ctx, args): Promise<Id<"requests">> => {
    if (args.providerId && !args.agreedPriceCents) {
      throw new Error("direct hire requires agreedPriceCents");
    }
    if (args.providerId === args.buyerId) {
      throw new Error("cannot hire yourself");
    }

    const status: Doc<"requests">["status"] = args.providerId
      ? "accepted"
      : "open";
    const acceptedAt = args.providerId ? Date.now() : undefined;

    return await ctx.db.insert("requests", {
      buyerId: args.buyerId,
      providerId: args.providerId,
      title: args.title,
      description: args.description,
      budgetMaxCents: args.budgetMaxCents,
      agreedPriceCents: args.agreedPriceCents,
      inputPayload: args.inputPayload,
      escrow: args.escrow,
      status,
      acceptedAt,
    });
  },
});

// Mark escrow funded — called after x402 settle on create.
export const linkEscrowReceipt = mutation({
  args: {
    requestId: v.id("requests"),
    escrowReceiptId: v.id("receipts"),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.requestId, {
      escrowReceiptId: args.escrowReceiptId,
    });
  },
});

// --- bids ---

export const submitBid = mutation({
  args: {
    requestId: v.id("requests"),
    bidderId: v.id("agents"),
    priceCents: v.number(),
    estimatedDurationSeconds: v.optional(v.number()),
    message: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<Id<"bids">> => {
    const req = await ctx.db.get(args.requestId);
    if (!req) throw new Error("Request not found");
    if (req.status !== "open") {
      throw new Error(`Cannot bid on request in status: ${req.status}`);
    }
    if (req.buyerId === args.bidderId) {
      throw new Error("cannot bid on your own request");
    }
    if (args.priceCents > req.budgetMaxCents) {
      throw new Error("bid exceeds request budget");
    }
    return await ctx.db.insert("bids", {
      requestId: args.requestId,
      bidderId: args.bidderId,
      priceCents: args.priceCents,
      estimatedDurationSeconds: args.estimatedDurationSeconds,
      message: args.message,
      status: "pending",
    });
  },
});

export const acceptBid = mutation({
  args: { bidId: v.id("bids") },
  handler: async (ctx, args) => {
    const bid = await ctx.db.get(args.bidId);
    if (!bid) throw new Error("Bid not found");
    if (bid.status !== "pending") throw new Error("Bid not pending");
    if (!bid.requestId) throw new Error("Legacy bid (no requestId)");
    const req = await ctx.db.get(bid.requestId);
    if (!req) throw new Error("Request not found");
    if (req.status !== "open") throw new Error("Request not open");

    // mark this bid accepted, others rejected
    const allBids = await ctx.db
      .query("bids")
      .withIndex("by_requestId", (q) => q.eq("requestId", bid.requestId!))
      .collect();
    for (const b of allBids) {
      if (b._id === bid._id) continue;
      if (b.status === "pending") {
        await ctx.db.patch(b._id, { status: "rejected" });
      }
    }
    await ctx.db.patch(bid._id, { status: "accepted" });
    await ctx.db.patch(req._id, {
      providerId: bid.bidderId!,
      agreedPriceCents: bid.priceCents,
      status: "accepted",
      acceptedAt: Date.now(),
    });
  },
});

// --- delivery + approval + cancellation ---

export const fulfill = mutation({
  args: {
    requestId: v.id("requests"),
    providerId: v.id("agents"),
    outputPayload: v.string(),
  },
  handler: async (ctx, args) => {
    const req = await ctx.db.get(args.requestId);
    if (!req) throw new Error("Request not found");
    if (req.providerId !== args.providerId) {
      throw new Error("only the assigned provider can fulfill");
    }
    if (req.status !== "accepted") {
      throw new Error(`cannot fulfill in status: ${req.status}`);
    }
    await ctx.db.patch(args.requestId, {
      outputPayload: args.outputPayload,
      status: "fulfilled",
      fulfilledAt: Date.now(),
    });
  },
});

// Set request to approved — should be called AFTER settlement receipt is emitted.
export const markApproved = mutation({
  args: {
    requestId: v.id("requests"),
    settlementReceiptId: v.id("receipts"),
  },
  handler: async (ctx, args) => {
    const req = await ctx.db.get(args.requestId);
    if (!req) throw new Error("Request not found");
    if (req.status !== "fulfilled") {
      throw new Error(`cannot approve in status: ${req.status}`);
    }
    await ctx.db.patch(args.requestId, {
      status: "approved",
      approvedAt: Date.now(),
      settlementReceiptId: args.settlementReceiptId,
    });
  },
});

export const markCancelled = mutation({
  args: {
    requestId: v.id("requests"),
    reason: v.optional(v.string()),
    refundReceiptId: v.optional(v.id("receipts")),
  },
  handler: async (ctx, args) => {
    const req = await ctx.db.get(args.requestId);
    if (!req) throw new Error("Request not found");
    if (req.status === "approved" || req.status === "cancelled") {
      throw new Error(`already terminal: ${req.status}`);
    }
    await ctx.db.patch(args.requestId, {
      status: "cancelled",
      cancelledAt: Date.now(),
      cancelReason: args.reason,
      settlementReceiptId: args.refundReceiptId,
    });
  },
});

// --- queries ---

export const getById = query({
  args: { requestId: v.id("requests") },
  handler: async (ctx, args): Promise<Doc<"requests"> | null> => {
    return await ctx.db.get(args.requestId);
  },
});

export const getWithBids = query({
  args: { requestId: v.id("requests") },
  handler: async (
    ctx,
    args,
  ): Promise<{ request: Doc<"requests"> | null; bids: Doc<"bids">[] }> => {
    const request = await ctx.db.get(args.requestId);
    if (!request) return { request: null, bids: [] };
    const bids = await ctx.db
      .query("bids")
      .withIndex("by_requestId", (q) => q.eq("requestId", args.requestId))
      .collect();
    return { request, bids };
  },
});

export const listOpen = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args): Promise<Doc<"requests">[]> => {
    const limit = Math.min(args.limit ?? 50, 200);
    return await ctx.db
      .query("requests")
      .withIndex("by_status", (q) => q.eq("status", "open"))
      .order("desc")
      .take(limit);
  },
});

export const listByBuyer = query({
  args: {
    buyerId: v.id("agents"),
    status: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<Doc<"requests">[]> => {
    return await ctx.db
      .query("requests")
      .withIndex("by_buyerId", (q) => q.eq("buyerId", args.buyerId))
      .collect();
  },
});

export const listByProvider = query({
  args: {
    providerId: v.id("agents"),
    status: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<Doc<"requests">[]> => {
    return await ctx.db
      .query("requests")
      .withIndex("by_providerId", (q) => q.eq("providerId", args.providerId))
      .collect();
  },
});

export const listBidsByBidder = query({
  args: { bidderId: v.id("agents") },
  handler: async (ctx, args): Promise<Doc<"bids">[]> => {
    return await ctx.db
      .query("bids")
      .withIndex("by_bidderId", (q) => q.eq("bidderId", args.bidderId))
      .collect();
  },
});

export const search = query({
  args: {
    query: v.string(),
    status: v.optional(
      v.union(
        v.literal("open"),
        v.literal("accepted"),
        v.literal("fulfilled"),
        v.literal("approved"),
        v.literal("cancelled"),
        v.literal("disputed"),
      ),
    ),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<Doc<"requests">[]> => {
    const limit = Math.min(args.limit ?? 50, 200);
    return await ctx.db
      .query("requests")
      .withSearchIndex("search_requests", (q) => {
        let s = q.search("description", args.query);
        if (args.status) s = s.eq("status", args.status);
        return s;
      })
      .take(limit);
  },
});

// Stale-accepted sweep — for cron auto-refund (>14d in accepted state).
export const listStaleAccepted = query({
  args: { cutoffMs: v.number() },
  handler: async (ctx, args): Promise<Doc<"requests">[]> => {
    return await ctx.db
      .query("requests")
      .withIndex("by_status_acceptedAt", (q) =>
        q.eq("status", "accepted").lte("acceptedAt", args.cutoffMs),
      )
      .filter((q) => q.eq(q.field("escrow"), true))
      .collect();
  },
});
