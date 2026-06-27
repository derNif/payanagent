import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { Doc, Id } from "./_generated/dataModel";

// Receipts — the compounding atom of PayanAgent.
// Created exclusively by settlement code paths in the HTTP layer.
// `recordSettlement` is platform-secret-gated so external callers can't fake receipts.
// HMAC signing via WebCrypto (works in V8 runtime).

const PLATFORM_INTERNAL_KEY = process.env.PLATFORM_INTERNAL_KEY ?? "";

// The receipt signing key MUST be set explicitly and be distinct from the
// wallet key. Fail closed rather than silently signing with a wallet key or a
// guessable default — receipts are the trust layer and must be unforgeable.
function receiptSecret(): string {
  const secret = process.env.PLATFORM_RECEIPT_SECRET;
  if (!secret) {
    throw new Error(
      "PLATFORM_RECEIPT_SECRET is not configured — refusing to sign receipts",
    );
  }
  return secret;
}

function canonicalize(body: {
  buyerId: string;
  sellerId: string;
  offerId: string | null;
  requestId: string | null;
  amountCents: number;
  currency: string;
  chain: string;
  network: string;
  txHash: string;
  settlementType: string;
  status: string;
  emittedAt: number;
}): string {
  return JSON.stringify({
    buyerId: body.buyerId,
    sellerId: body.sellerId,
    offerId: body.offerId,
    requestId: body.requestId,
    amountCents: body.amountCents,
    currency: body.currency,
    chain: body.chain,
    network: body.network,
    txHash: body.txHash,
    settlementType: body.settlementType,
    status: body.status,
    emittedAt: body.emittedAt,
  });
}

async function sign(canonical: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(receiptSecret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(canonical));
  const bytes = new Uint8Array(sig);
  let hex = "";
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, "0");
  }
  return hex;
}

// Called by settlement code paths in the HTTP layer.
// Gated by PLATFORM_INTERNAL_KEY so external callers can't fake receipts.
export const recordSettlement = mutation({
  args: {
    platformSecret: v.string(),
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
  },
  handler: async (ctx, args): Promise<Id<"receipts">> => {
    if (!PLATFORM_INTERNAL_KEY || args.platformSecret !== PLATFORM_INTERNAL_KEY) {
      throw new Error("unauthorized: invalid platform secret");
    }

    const emittedAt = Date.now();
    const canonical = canonicalize({
      buyerId: args.buyerId as unknown as string,
      sellerId: args.sellerId as unknown as string,
      offerId: (args.offerId as unknown as string | undefined) ?? null,
      requestId: (args.requestId as unknown as string | undefined) ?? null,
      amountCents: args.amountCents,
      currency: args.currency,
      chain: args.chain,
      network: args.network,
      txHash: args.txHash,
      settlementType: args.settlementType,
      status: args.status,
      emittedAt,
    });
    const signature = await sign(canonical);

    const { platformSecret: _, ...rest } = args;
    void _;
    return await ctx.db.insert("receipts", {
      ...rest,
      signature,
      emittedAt,
    });
  },
});

// --- public queries ---

export const listFeed = query({
  args: { limit: v.optional(v.number()) },
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

// Idempotency guard for escrow settlement: returns an existing release/refund
// receipt for a request, if any. Used to avoid a second on-chain payout if a
// prior attempt already moved the funds.
export const getSettlementForRequest = query({
  args: { requestId: v.id("requests") },
  handler: async (ctx, args): Promise<Doc<"receipts"> | null> => {
    const receipts = await ctx.db
      .query("receipts")
      .withIndex("by_requestId", (q) => q.eq("requestId", args.requestId))
      .collect();
    return (
      receipts.find(
        (r) =>
          r.settlementType === "escrow_release" ||
          r.settlementType === "escrow_refund",
      ) ?? null
    );
  },
});

export const listByAgent = query({
  args: {
    agentId: v.id("agents"),
    side: v.optional(
      v.union(v.literal("buyer"), v.literal("seller"), v.literal("both")),
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

// Record whether a settled receipt's service actually delivered. Platform-secret
// gated (same trust boundary as recordSettlement). Called by the buy/x402/approve
// routes after the delivery attempt.
export const markDelivered = mutation({
  args: {
    platformSecret: v.string(),
    receiptId: v.id("receipts"),
    delivered: v.boolean(),
    deliveryStatus: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    if (!PLATFORM_INTERNAL_KEY || args.platformSecret !== PLATFORM_INTERNAL_KEY) {
      throw new Error("unauthorized: invalid platform secret");
    }
    await ctx.db.patch(args.receiptId, {
      delivered: args.delivered,
      deliveryStatus: args.deliveryStatus,
    });
  },
});

// Objective, wash-resistant reputation derived from a seller's receipts. Pure
// helper so offer/discovery queries can reuse it without N extra queries.
// Success rate is weighted by buyer DIVERSITY (one wallet can't manufacture
// trust) and every fake buy costs real USDC. Transparent components only.
export function computeReputation(sellerReceipts: Doc<"receipts">[]) {
  const confirmed = sellerReceipts.filter((r) => r.status === "confirmed");
  const sales = confirmed.length;
  if (sales === 0) {
    return {
      sales: 0,
      distinctBuyers: 0,
      volumeCents: 0,
      successRate: 1,
      score: 0,
      trusted: false,
      lastActiveAt: null as number | null,
      firstSaleAt: null as number | null,
    };
  }
  const distinctBuyers = new Set(confirmed.map((r) => String(r.buyerId))).size;
  const volumeCents = confirmed.reduce((s, r) => s + r.amountCents, 0);
  // Legacy receipts (delivered undefined, pre-feature) count as delivered.
  const deliveredOk = confirmed.filter((r) => r.delivered !== false).length;
  const successRate = deliveredOk / sales;
  const confidence = Math.min(1, distinctBuyers / 5);
  return {
    sales,
    distinctBuyers,
    volumeCents,
    successRate: Math.round(successRate * 100) / 100,
    score: Math.round(successRate * 100 * (0.5 + 0.5 * confidence)),
    trusted: distinctBuyers >= 3 && successRate >= 0.9 && sales >= 5,
    lastActiveAt: confirmed.reduce((m, r) => Math.max(m, r.emittedAt), 0),
    firstSaleAt: confirmed.reduce((m, r) => Math.min(m, r.emittedAt), confirmed[0].emittedAt),
  };
}

// Instantly-usable reputation for a seller so agents don't parse raw receipts.
export const getReputation = query({
  args: { agentId: v.id("agents") },
  handler: async (ctx, args) => {
    const sold = await ctx.db
      .query("receipts")
      .withIndex("by_sellerId", (q) => q.eq("sellerId", args.agentId))
      .take(1000);
    return computeReputation(sold);
  },
});

// One-shot data for the leaderboard dashboard: global stats, ranked sellers
// (with reputation), and a recent settlement feed (with party names). Capped
// reads. Designed for a single live useQuery so the board feels alive.
export const getLeaderboard = query({
  args: {},
  handler: async (ctx) => {
    const recent = await ctx.db
      .query("receipts")
      .withIndex("by_emittedAt")
      .order("desc")
      .take(2000);
    const confirmed = recent.filter((r) => r.status === "confirmed");
    const now = recent.length ? recent[0].emittedAt : 0;
    const weekAgo = now - 7 * 24 * 60 * 60 * 1000;
    const last7d = confirmed.filter((r) => r.emittedAt >= weekAgo);

    // Aggregate per seller.
    type Acc = { sellerId: Id<"agents">; volumeCents: number; sales: number; buyers: Set<string>; delivered: number };
    const bySeller = new Map<string, Acc>();
    for (const r of confirmed) {
      const k = String(r.sellerId);
      const cur = bySeller.get(k) ?? { sellerId: r.sellerId, volumeCents: 0, sales: 0, buyers: new Set(), delivered: 0 };
      cur.volumeCents += r.amountCents;
      cur.sales += 1;
      cur.buyers.add(String(r.buyerId));
      if (r.delivered !== false) cur.delivered += 1;
      bySeller.set(k, cur);
    }
    const ranked = [...bySeller.values()]
      .map((s) => {
        const distinctBuyers = s.buyers.size;
        const successRate = s.sales ? s.delivered / s.sales : 1;
        const confidence = Math.min(1, distinctBuyers / 5);
        return {
          sellerId: s.sellerId,
          volumeCents: s.volumeCents,
          sales: s.sales,
          distinctBuyers,
          successRate: Math.round(successRate * 100) / 100,
          score: Math.round(successRate * 100 * (0.5 + 0.5 * confidence)),
          trusted: distinctBuyers >= 3 && successRate >= 0.9 && s.sales >= 5,
        };
      })
      .sort((a, b) => b.volumeCents - a.volumeCents)
      .slice(0, 50);

    // Resolve names (sellers + feed parties), cached.
    const nameCache = new Map<string, { name: string; providerType: string } | null>();
    const resolve = async (id: Id<"agents">) => {
      const k = String(id);
      if (!nameCache.has(k)) {
        const a = await ctx.db.get(id);
        nameCache.set(k, a ? { name: a.name, providerType: a.providerType } : null);
      }
      return nameCache.get(k);
    };

    const topSellers = [];
    for (const s of ranked) {
      const info = await resolve(s.sellerId);
      topSellers.push({ ...s, name: info?.name ?? "Unknown", providerType: info?.providerType ?? "agent" });
    }

    const feed = [];
    for (const r of confirmed.slice(0, 25)) {
      const [buyer, seller] = [await resolve(r.buyerId), await resolve(r.sellerId)];
      feed.push({
        _id: r._id,
        amountCents: r.amountCents,
        settlementType: r.settlementType,
        delivered: r.delivered,
        emittedAt: r.emittedAt,
        buyerName: buyer?.name ?? "agent",
        sellerName: seller?.name ?? "agent",
      });
    }

    return {
      stats: {
        totalVolumeCents: confirmed.reduce((s, r) => s + r.amountCents, 0),
        totalReceipts: confirmed.length,
        distinctSellers: bySeller.size,
        distinctBuyers: new Set(confirmed.map((r) => String(r.buyerId))).size,
        volume7dCents: last7d.reduce((s, r) => s + r.amountCents, 0),
        receipts7d: last7d.length,
      },
      topSellers,
      feed,
    };
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
      totalEarnedCents: sellerConfirmed.reduce((s, r) => s + r.amountCents, 0),
      totalSpentCents: buyerConfirmed.reduce((s, r) => s + r.amountCents, 0),
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
