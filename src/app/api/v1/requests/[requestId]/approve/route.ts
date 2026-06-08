import { NextRequest, NextResponse } from "next/server";
import { getConvexClient } from "@/lib/convex";
import { authenticateRequest } from "@/lib/auth";
import {
  releaseEscrow,
  getFacilitatorUrl,
  getNetwork,
  getNetworkId,
} from "@/lib/x402";
import { api } from "@convex/_generated/api";
import { Id } from "@convex/_generated/dataModel";

// POST /api/v1/requests/:requestId/approve — Buyer approves the fulfilled work.
// Releases escrow on-chain to the provider's wallet, emits escrow_release receipt,
// marks the request as approved.
// v0.2 path. Replaces v1 /complete.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ requestId: string }> },
) {
  const startedAt = Date.now();
  const { agent, error } = await authenticateRequest(request);
  if (error) return error;

  const { requestId } = await params;
  const convex = getConvexClient();

  let req;
  try {
    req = await convex.query(api.requests.getById, {
      requestId: requestId as Id<"requests">,
    });
  } catch {
    return NextResponse.json({ error: "Invalid request ID" }, { status: 400 });
  }
  if (!req) {
    return NextResponse.json({ error: "Request not found" }, { status: 404 });
  }
  if (req.buyerId !== agent._id) {
    return NextResponse.json(
      { error: "Only the buyer can approve" },
      { status: 403 },
    );
  }
  if (req.status !== "fulfilled") {
    return NextResponse.json(
      { error: `Cannot approve a request in status: ${req.status}` },
      { status: 400 },
    );
  }
  if (!req.providerId) {
    return NextResponse.json(
      { error: "Request has no assigned provider" },
      { status: 500 },
    );
  }
  if (!req.agreedPriceCents) {
    return NextResponse.json(
      { error: "Request has no agreed price" },
      { status: 500 },
    );
  }
  if (!req.escrow) {
    // For non-escrow requests, payment is buyer-pull. v0.2 expects buy-side
    // escrow for marketplace mode; non-escrow approvals are out of scope here
    // and will be revisited when buyer-pull settlement is wired.
    return NextResponse.json(
      { error: "Non-escrow approve not yet supported in v0.2" },
      { status: 400 },
    );
  }

  // Look up provider wallet
  const provider = await convex.query(api.agents.getById, {
    agentId: req.providerId,
  });
  if (!provider) {
    return NextResponse.json({ error: "Provider not found" }, { status: 500 });
  }

  // Release escrow on-chain
  const release = await releaseEscrow(
    provider.walletAddress,
    req.agreedPriceCents,
  );
  if (!release.success || !release.txHash) {
    return NextResponse.json(
      { error: `Escrow release failed: ${release.error || "unknown"}` },
      { status: 502 },
    );
  }

  // Emit escrow_release receipt
  const platformSecret = process.env.PLATFORM_INTERNAL_KEY || "";
  if (!platformSecret) {
    return NextResponse.json(
      { error: "Platform misconfigured: missing PLATFORM_INTERNAL_KEY" },
      { status: 500 },
    );
  }
  const receiptId: Id<"receipts"> = await convex.mutation(
    api.receipts.recordSettlement,
    {
      platformSecret,
      buyerId: req.buyerId,
      sellerId: req.providerId,
      requestId: req._id,
      amountCents: req.agreedPriceCents,
      currency: "USDC",
      chain: getNetwork(),
      network: getNetworkId(),
      txHash: release.txHash,
      facilitatorUrl: getFacilitatorUrl(),
      settlementType: "escrow_release",
      status: "confirmed",
      latencyMs: Date.now() - startedAt,
    },
  );

  // Mark the request approved
  await convex.mutation(api.requests.markApproved, {
    requestId: req._id,
    settlementReceiptId: receiptId,
  });

  return NextResponse.json({
    ok: true,
    receiptId,
    txHash: release.txHash,
  });
}
