import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { getConvexClient } from "@/lib/convex";
import { validateBody, forceTimeoutSchema } from "@/lib/validation";
import {
  getFacilitatorUrl,
  getNetwork,
  getNetworkId,
  releaseEscrow,
} from "@/lib/x402";
import { api } from "@convex/_generated/api";
import { Id } from "@convex/_generated/dataModel";

// POST /api/v1/admin/jobs/:jobId/force-timeout?key=ADMIN_KEY
//
// Admin-only manual override for the escrow timeout auto-refund (gap #4).
// Bypasses the 14-day threshold enforced by the daily cron sweep; the
// `accepted` status gate + atomic `timingOut` lock + revert-on-chain-failure
// remain in force.
//
// Use when the client needs their escrow back before the 14-day window
// (e.g. provider has clearly absconded) and the Board is intervening
// manually. For the normal case, let the cron handle it.
//
// Security:
//   - ADMIN_KEY via ?key=..., constant-time compare (matches dispute/resolve).
//   - On-chain transfer reuses src/lib/x402.ts#releaseEscrow — the same
//     recipient-agnostic helper used by complete / cancel / dispute-resolve.
//   - Atomic lock (markTimingOut) prevents the cron and an admin call from
//     double-refunding the same job.
function adminAuthorized(request: NextRequest): boolean {
  const adminKey = process.env.ADMIN_KEY;
  if (!adminKey) return false;
  const provided = request.nextUrl.searchParams.get("key") ?? "";
  const a = Buffer.from(adminKey);
  const b = Buffer.from(provided);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  if (!adminAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { jobId } = await params;
  const convex = getConvexClient();

  const { error: validationError } = await validateBody(
    request,
    forceTimeoutSchema
  );
  if (validationError) return validationError;

  try {
    const job = await convex.query(api.jobs.getById, {
      jobId: jobId as Id<"jobs">,
    });
    if (!job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }
    if (job.status !== "accepted") {
      return NextResponse.json(
        {
          error: `Only 'accepted' jobs can be force-timed-out. Current: ${job.status}`,
        },
        { status: 400 }
      );
    }
    if (!job.agreedPriceCents) {
      return NextResponse.json(
        { error: "Accepted job has no agreed price — data integrity error" },
        { status: 500 }
      );
    }

    const client = await convex.query(api.agents.getById, {
      agentId: job.clientAgentId,
    });
    if (!client?.walletAddress) {
      return NextResponse.json(
        { error: "Client has no wallet address configured" },
        { status: 400 }
      );
    }

    try {
      await convex.mutation(api.jobs.markTimingOut, {
        jobId: jobId as Id<"jobs">,
      });
    } catch {
      return NextResponse.json(
        { error: "Timeout already in progress" },
        { status: 409 }
      );
    }

    const refund = await releaseEscrow(
      client.walletAddress,
      job.agreedPriceCents
    );
    if (!refund.success) {
      await convex.mutation(api.jobs.revertFromTimingOut, {
        jobId: jobId as Id<"jobs">,
      });
      return NextResponse.json(
        { error: `Refund failed: ${refund.error}` },
        { status: 500 }
      );
    }

    const refundTxId = await convex.mutation(api.transactions.create, {
      fromAgentId: job.clientAgentId,
      toAgentId: job.clientAgentId,
      jobId: jobId as Id<"jobs">,
      amountCents: job.agreedPriceCents,
      currency: "USDC",
      chain: getNetwork(),
      network: getNetworkId(),
      txHash: refund.txHash,
      facilitatorUrl: getFacilitatorUrl(),
      type: "refund",
      status: "confirmed",
      confirmedAt: Date.now(),
    });

    await convex.mutation(api.jobs.finalizeTimeout, {
      jobId: jobId as Id<"jobs">,
    });

    return NextResponse.json({
      message: `Job force-timed-out. $${(job.agreedPriceCents / 100).toFixed(
        2
      )} USDC refunded to client.`,
      jobId,
      refunded: true,
      refundTransactionId: refundTxId,
      txHash: refund.txHash,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
