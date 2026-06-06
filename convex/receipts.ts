import { v } from "convex/values";
import { internalMutation, query } from "./_generated/server";
import { Doc, Id } from "./_generated/dataModel";

// Receipts — the compounding atom of PayanAgent.
// This file (V8 runtime) holds the public queries and the _insert mutation.
// HMAC signing lives in receiptsSigner.ts (Node runtime), which calls _insert via
// internal.receipts._insert after signing.

// --- mutation: pure write, signed body already computed by signer action ---

export const _insert = internalMutation({
  args: {
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
  },
  handler: async (ctx, args): Promise<Id<"receipts">> => {
    return await ctx.db.insert("receipts", args);
  },
});

// --- public queries ---

export const listFeed = query({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<Doc<"receipts">[]> => {
    const limit = Math.min(args.limit ?? 50, 200);
    return await ctx.db
      .query("receipts")
      .withIndex("by_emittedAt")
      .order("desc")
      .take(limit);
  },
});

export const getById = query({
  args: { receiptId: v.id("receipts") },
  handler: async (ctx, args): Promise<Doc<"receipts"> | null> => {
    return await ctx.db.get(args.receiptId);
  },
});

export const listByAgent = query({
  args: {
    agentId: v.id("agents"),
    side: v.optional(
      v.union(
        v.literal("buyer"),
        v.literal("seller"),
        v.literal("both"),
      ),
    ),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<Doc<"receipts">[]> => {
    const limit = Math.min(args.limit ?? 50, 200);
    const side = args.side ?? "both";

    if (side === "buyer") {
      return await ctx.db
        .query("receipts")
        .withIndex("by_buyerId", (q) => q.eq("buyerId", args.agentId))
        .order("desc")
        .take(limit);
    }
    if (side === "seller") {
      return await ctx.db
        .query("receipts")
        .withIndex("by_sellerId", (q) => q.eq("sellerId", args.agentId))
        .order("desc")
        .take(limit);
    }

    const asBuyer = await ctx.db
      .query("receipts")
      .withIndex("by_buyerId", (q) => q.eq("buyerId", args.agentId))
      .order("desc")
      .take(limit);
    const asSeller = await ctx.db
      .query("receipts")
      .withIndex("by_sellerId", (q) => q.eq("sellerId", args.agentId))
      .order("desc")
      .take(limit);
    return [...asBuyer, ...asSeller]
      .sort((a, b) => b.emittedAt - a.emittedAt)
      .slice(0, limit);
  },
});

export const getAgentStats = query({
  args: { agentId: v.id("agents") },
  handler: async (
    ctx,
    args,
  ): Promise<{
    totalEarnedCents: number;
    totalSpentCents: number;
    receiptsSold: number;
    receiptsBought: number;
  }> => {
    const asSeller = await ctx.db
      .query("receipts")
      .withIndex("by_sellerId", (q) => q.eq("sellerId", args.agentId))
      .take(500);
    const asBuyer = await ctx.db
      .query("receipts")
      .withIndex("by_buyerId", (q) => q.eq("buyerId", args.agentId))
      .take(500);

    const sellerConfirmed = asSeller.filter((r) => r.status === "confirmed");
    const buyerConfirmed = asBuyer.filter((r) => r.status === "confirmed");

    return {
      totalEarnedCents: sellerConfirmed.reduce(
        (s, r) => s + r.amountCents,
        0,
      ),
      totalSpentCents: buyerConfirmed.reduce(
        (s, r) => s + r.amountCents,
        0,
      ),
      receiptsSold: sellerConfirmed.length,
      receiptsBought: buyerConfirmed.length,
    };
  },
});

export const getGlobalStats = query({
  args: {},
  handler: async (
    ctx,
  ): Promise<{
    totalReceipts: number;
    totalVolumeCents: number;
    receiptsLast7d: number;
    volumeLast7dCents: number;
  }> => {
    const recent = await ctx.db
      .query("receipts")
      .withIndex("by_emittedAt")
      .order("desc")
      .take(1000);
    const confirmed = recent.filter((r) => r.status === "confirmed");
    const now = Date.now();
    const oneWeekAgo = now - 7 * 24 * 60 * 60 * 1000;
    const last7d = confirmed.filter((r) => r.emittedAt >= oneWeekAgo);

    return {
      totalReceipts: confirmed.length,
      totalVolumeCents: confirmed.reduce((s, r) => s + r.amountCents, 0),
      receiptsLast7d: last7d.length,
      volumeLast7dCents: last7d.reduce((s, r) => s + r.amountCents, 0),
    };
  },
});

export const topSellers = query({
  args: { limit: v.optional(v.number()) },
  handler: async (
    ctx,
    args,
  ): Promise<Array<{
    sellerId: Id<"agents">;
    totalEarnedCents: number;
    receiptCount: number;
  }>> => {
    const limit = Math.min(args.limit ?? 50, 200);
    const recent = await ctx.db
      .query("receipts")
      .withIndex("by_emittedAt")
      .order("desc")
      .take(2000);
    const confirmed = recent.filter((r) => r.status === "confirmed");

    const bySeller = new Map<
      string,
      { sellerId: Id<"agents">; totalEarnedCents: number; receiptCount: number }
    >();
    for (const r of confirmed) {
      const key = String(r.sellerId);
      const cur = bySeller.get(key) ?? {
        sellerId: r.sellerId,
        totalEarnedCents: 0,
        receiptCount: 0,
      };
      cur.totalEarnedCents += r.amountCents;
      cur.receiptCount += 1;
      bySeller.set(key, cur);
    }
    return [...bySeller.values()]
      .sort((a, b) => b.totalEarnedCents - a.totalEarnedCents)
      .slice(0, limit);
  },
});
