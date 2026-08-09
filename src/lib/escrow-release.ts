// Crash-safe on-chain escrow payout (release to provider / refund to buyer).
//
// The invariant this file exists to hold: A RETRY MUST NEVER PAY TWICE. The
// receipt is written BEFORE the transfer (status "pending"), so the moment
// funds can move there is already a durable record — a crash anywhere after
// `releaseEscrow` leaves a pending receipt that the route's idempotency check
// finds on retry, instead of finding nothing and releasing again.
//
// Lifecycle: pending(no tx) → pending(txHash) → confirmed | failed.
// Only "confirmed" counts toward reputation/volume (convex/receipts.ts filters
// on it), so a pending receipt is inert until the chain confirms.
import type { ConvexHttpClient } from "convex/browser";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { recordSettlementReceipt } from "./settlement";
import { logError, swallow } from "./errors";
import { confirmTxOnChain, releaseEscrow } from "./x402";

export type EscrowPayoutResult =
  | {
      ok: true;
      receiptId: Id<"receipts">;
      txHash: string;
      // "unknown" = facilitator accepted the tx but the chain didn't confirm
      // within the bound; the receipt stays pending for later reconciliation.
      onChain: "confirmed" | "unknown";
    }
  | { ok: false; error: string };

export async function payoutEscrow({
  convex,
  platformSecret,
  buyerId,
  sellerId,
  requestId,
  toAddress,
  amountCents,
  settlementType,
  startedAt,
  deps = {},
}: {
  convex: ConvexHttpClient;
  platformSecret: string;
  buyerId: Id<"agents">;
  sellerId: Id<"agents">;
  requestId: Id<"requests">;
  toAddress: string;
  amountCents: number;
  settlementType: "escrow_release" | "escrow_refund";
  startedAt: number;
  // Injectable for tests; production uses the real transfer + chain check.
  deps?: {
    releaseEscrow?: typeof releaseEscrow;
    confirmTx?: typeof confirmTxOnChain;
  };
}): Promise<EscrowPayoutResult> {
  const doRelease = deps.releaseEscrow ?? releaseEscrow;
  const confirmTx = deps.confirmTx ?? confirmTxOnChain;
  const scope = `escrow.${settlementType}`;

  // 1. Durable intent BEFORE money moves. If this write fails, no transfer has
  //    happened and the caller's error path is a clean retry.
  const receiptId = await recordSettlementReceipt(convex, {
    platformSecret,
    buyerId,
    sellerId,
    requestId,
    amountCents,
    amountMicroUsd: amountCents * 10000,
    txHash: "",
    settlementType,
    latencyMs: Date.now() - startedAt,
    status: "pending",
  });

  const finalize = (txHash: string | undefined, status: "pending" | "confirmed" | "failed") =>
    convex.mutation(api.receipts.finalizeSettlement, {
      platformSecret,
      receiptId,
      txHash,
      status,
    });

  // 2. The transfer. The idempotency key pins the ERC-3009 nonce to this
  //    payout, so even if the facilitator's answer is lost (timeout after
  //    submission) a retry re-signs the SAME authorization and the token
  //    contract guarantees at most one attempt ever moves funds.
  const release = await doRelease(toAddress, amountCents, `${requestId}:${settlementType}`);
  if (!release.success || !release.txHash) {
    if (release.alreadyUsed) {
      // A previous attempt's transfer landed on-chain but its receipt wasn't
      // finalized. Funds moved exactly once — keep the receipt pending so the
      // idempotency check blocks further retries while an operator (or a
      // reconciler) locates the tx and confirms it.
      logError(`${scope}:already-used`, "nonce already used on-chain; needs reconciliation", {
        receiptId,
        requestId,
      });
      return { ok: false, error: release.error || "authorization already used" };
    }
    // Clean failure: no tx was accepted. Mark failed so the idempotency check
    // lets a retry through. If even this write fails, the receipt stays
    // pending and BLOCKS retries — the safe direction (funds can't double-pay;
    // an operator resolves it from the log line).
    await finalize(undefined, "failed").catch(swallow(`${scope}:mark-failed`, { receiptId }));
    return { ok: false, error: release.error || "unknown" };
  }

  // 3. Attach the tx hash immediately (still pending) — from here on the chain
  //    is the source of truth and the receipt points straight at it.
  await finalize(release.txHash, "pending").catch(
    swallow(`${scope}:attach-txhash`, { receiptId, txHash: release.txHash }),
  );

  // 4. Confirm on-chain before the receipt claims "confirmed". A facilitator
  //    tx hash is a submission, not a guarantee.
  const onChain = await confirmTx(release.txHash);
  if (onChain === "reverted") {
    // The transfer provably did not move funds.
    await finalize(release.txHash, "failed").catch(
      swallow(`${scope}:mark-reverted`, { receiptId, txHash: release.txHash }),
    );
    return { ok: false, error: "transfer reverted on-chain" };
  }
  if (onChain === "confirmed") {
    await finalize(release.txHash, "confirmed").catch(
      swallow(`${scope}:mark-confirmed`, { receiptId, txHash: release.txHash }),
    );
    return { ok: true, receiptId, txHash: release.txHash, onChain: "confirmed" };
  }

  // Chain didn't answer within the bound: leave pending, reconcile later.
  logError(`${scope}:confirm-timeout`, "tx not confirmed within bound", {
    receiptId,
    txHash: release.txHash,
  });
  return { ok: true, receiptId, txHash: release.txHash, onChain: "unknown" };
}
