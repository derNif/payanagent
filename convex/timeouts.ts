"use node";

// Escrow timeout auto-refund — gap list #4 (PAY-49).
//
// Runs daily via `convex/crons.ts`. If an `accepted` job sits unfulfilled past
// JOB_ACCEPT_TIMEOUT_MS (14 days), the client's escrow is refunded on-chain
// and the job transitions to `failed` with failureReason="timeout". A
// `job.timed_out` webhook fires to both parties.
//
// Architecture mirrors cancel + dispute/resolve:
//   1. markTimingOut (atomic accepted → timingOut lock; prevents double-refund)
//   2. on-chain USDC transfer back to client
//   3. transactions row (type=refund, reason=auto_timeout)
//   4. finalizeTimeout (timingOut → failed, fire webhook)
//   on any step-2 failure: revertFromTimingOut (timingOut → accepted) so the
//   job rejoins the stale pool on the next sweep.
//
// The Next.js side has a sibling admin override at
// POST /api/v1/admin/jobs/:id/force-timeout that performs the same flow with
// no age threshold and is admin-key gated.
//
// Intentionally self-contained inside Convex: the on-chain transfer helper is
// inlined below (mirroring src/lib/x402.ts#releaseEscrow) because the Next.js
// module imports `next/server` and can't be pulled into the Convex bundler.
// Any change to the transfer logic must be mirrored on both sides. Board
// review required for touching either copy.

import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  createWalletClient,
  createPublicClient,
  http,
  parseAbi,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base, baseSepolia } from "viem/chains";

const JOB_ACCEPT_TIMEOUT_DAYS = 14;
const JOB_ACCEPT_TIMEOUT_MS =
  JOB_ACCEPT_TIMEOUT_DAYS * 24 * 60 * 60 * 1000;

const SWEEP_BATCH_LIMIT = 100;

const NETWORK = process.env.X402_NETWORK || "base";

const CHAIN_IDS: Record<string, string> = {
  "base-sepolia": "eip155:84532",
  base: "eip155:8453",
};

const USDC_ADDRESSES: Record<string, string> = {
  "eip155:84532": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  "eip155:8453": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const VIEM_CHAINS: Record<string, any> = {
  base,
  "base-sepolia": baseSepolia,
};

const ERC20_TRANSFER_ABI = parseAbi([
  "function transfer(address to, uint256 amount) returns (bool)",
]);

function getFacilitatorUrl(): string {
  return (
    process.env.X402_FACILITATOR_URL ||
    (NETWORK === "base-sepolia"
      ? "https://x402.org/facilitator"
      : "https://facilitator.xpay.sh")
  );
}

function getNetworkId(): string {
  return CHAIN_IDS[NETWORK] || CHAIN_IDS["base"];
}

async function releaseEscrow(
  toAddress: string,
  amountCents: number
): Promise<{ success: boolean; txHash?: string; error?: string }> {
  const privateKey = process.env.PLATFORM_WALLET_PRIVATE_KEY;
  if (!privateKey) {
    return {
      success: false,
      error: "PLATFORM_WALLET_PRIVATE_KEY not configured",
    };
  }
  if (!/^0x[a-fA-F0-9]{64}$/.test(privateKey)) {
    return { success: false, error: "Invalid private key format" };
  }

  try {
    const networkId = getNetworkId();
    const usdcAddress = USDC_ADDRESSES[networkId] as `0x${string}`;
    const chain = VIEM_CHAINS[NETWORK] || base;
    const account = privateKeyToAccount(privateKey as `0x${string}`);
    const amountBaseUnits = BigInt(amountCents) * BigInt(10000);

    const walletClient = createWalletClient({
      account,
      chain,
      transport: http(),
    });

    const publicClient = createPublicClient({
      chain,
      transport: http(),
    });

    const hash = await walletClient.writeContract({
      address: usdcAddress,
      abi: ERC20_TRANSFER_ABI,
      functionName: "transfer",
      args: [toAddress as `0x${string}`, amountBaseUnits],
      chain,
    } as Parameters<typeof walletClient.writeContract>[0]);

    const receipt = await publicClient.waitForTransactionReceipt({ hash });

    return {
      success: receipt.status === "success",
      txHash: hash,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Escrow release failed",
    };
  }
}

// Daily cron entry point. Finds all accepted jobs past the timeout window
// and processes each in turn. Intentionally sequential to avoid racing the
// same wallet nonce; a single daily sweep with a small pool does not need
// parallelism.
export const sweep = internalAction({
  args: {},
  handler: async (ctx): Promise<{ processed: number; failed: number }> => {
    const cutoffMs = Date.now() - JOB_ACCEPT_TIMEOUT_MS;
    const stale = await ctx.runQuery(api.jobs.listStaleAccepted, {
      cutoffMs,
      limit: SWEEP_BATCH_LIMIT,
    });

    let processed = 0;
    let failed = 0;
    for (const row of stale) {
      try {
        const result = await ctx.runAction(
          internal.timeouts.processOneTimeout,
          { jobId: row._id }
        );
        if (result.success) {
          processed += 1;
        } else {
          failed += 1;
        }
      } catch {
        failed += 1;
      }
    }
    return { processed, failed };
  },
});

// Refund a single stale (or admin-forced) accepted job.
//
// Two entry points:
//   - cron sweep (threshold already enforced at query time)
//   - admin force-timeout route (no threshold, arbitrary accepted job)
//
// The atomic lock is `timingOut`. Either path is safe to call against the
// same job: the second caller hits markTimingOut and fails with "Cannot begin
// timeout" once the first holds the lock.
export const processOneTimeout = internalAction({
  args: { jobId: v.id("jobs") },
  handler: async (
    ctx,
    args
  ): Promise<{
    success: boolean;
    error?: string;
    txHash?: string;
    refundTransactionId?: Id<"transactions">;
  }> => {
    const job = await ctx.runQuery(api.jobs.getById, { jobId: args.jobId });
    if (!job) return { success: false, error: "Job not found" };
    if (job.status !== "accepted") {
      return {
        success: false,
        error: `Expected status=accepted, got ${job.status}`,
      };
    }
    if (!job.agreedPriceCents) {
      return {
        success: false,
        error: "Accepted job has no agreed price — data integrity error",
      };
    }

    const client = await ctx.runQuery(api.agents.getById, {
      agentId: job.clientAgentId,
    });
    if (!client?.walletAddress) {
      return {
        success: false,
        error: "Client has no wallet address configured",
      };
    }

    try {
      await ctx.runMutation(api.jobs.markTimingOut, { jobId: args.jobId });
    } catch {
      return { success: false, error: "Timeout already in progress" };
    }

    const refund = await releaseEscrow(client.walletAddress, job.agreedPriceCents);
    if (!refund.success) {
      await ctx.runMutation(api.jobs.revertFromTimingOut, {
        jobId: args.jobId,
      });
      return {
        success: false,
        error: `Refund failed: ${refund.error}`,
      };
    }

    const refundTransactionId = await ctx.runMutation(api.transactions.create, {
      fromAgentId: job.clientAgentId,
      toAgentId: job.clientAgentId,
      jobId: args.jobId,
      amountCents: job.agreedPriceCents,
      currency: "USDC",
      chain: NETWORK,
      network: getNetworkId(),
      txHash: refund.txHash,
      facilitatorUrl: getFacilitatorUrl(),
      type: "refund",
      status: "confirmed",
      confirmedAt: Date.now(),
    });

    await ctx.runMutation(api.jobs.finalizeTimeout, { jobId: args.jobId });

    return {
      success: true,
      txHash: refund.txHash,
      refundTransactionId,
    };
  },
});
