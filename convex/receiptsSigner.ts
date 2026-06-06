"use node";

import { v } from "convex/values";
import { createHmac } from "node:crypto";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { Id } from "./_generated/dataModel";

// Receipt signing — Node runtime for HMAC-SHA256.
// Settlement code paths call internal.receiptsSigner.emit, which signs a canonical
// body and then writes via internal.receipts._insert.

const RECEIPT_SECRET =
  process.env.PLATFORM_RECEIPT_SECRET ||
  process.env.PLATFORM_WALLET_PRIVATE_KEY ||
  "dev-fallback-secret";

type CanonicalBody = {
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
};

function canonicalize(body: CanonicalBody): string {
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

function sign(canonical: string): string {
  return createHmac("sha256", RECEIPT_SECRET).update(canonical).digest("hex");
}

export const emit = internalAction({
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
  },
  handler: async (ctx, args): Promise<Id<"receipts">> => {
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
    const signature = sign(canonical);
    const id: Id<"receipts"> = await ctx.runMutation(
      internal.receipts._insert,
      { ...args, signature, emittedAt },
    );
    return id;
  },
});
