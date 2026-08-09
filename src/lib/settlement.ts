// Every settled payment writes a receipt with the same USDC/chain/facilitator
// envelope; only the parties, amount, tx hash and settlement type differ.
import type { ConvexHttpClient } from "convex/browser";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { getFacilitatorUrl, getNetwork, getNetworkId } from "./x402";

export type SettlementType =
  | "direct"
  | "escrow_deposit"
  | "escrow_release"
  | "escrow_refund"
  | "external";

export async function recordSettlementReceipt(
  convex: ConvexHttpClient,
  args: {
    platformSecret: string;
    buyerId: Id<"agents">;
    sellerId: Id<"agents">;
    offerId?: Id<"offers">;
    requestId?: Id<"requests">;
    amountCents: number;
    amountMicroUsd?: number;
    txHash: string;
    settlementType: SettlementType;
    latencyMs?: number;
  },
): Promise<Id<"receipts">> {
  return await convex.mutation(api.receipts.recordSettlement, {
    ...args,
    currency: "USDC",
    chain: getNetwork(),
    network: getNetworkId(),
    facilitatorUrl: getFacilitatorUrl(),
    status: "confirmed",
  });
}
