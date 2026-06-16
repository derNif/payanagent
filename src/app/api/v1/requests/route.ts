import { NextRequest, NextResponse } from "next/server";
import { getConvexClient } from "@/lib/convex";
import { authenticateRequest } from "@/lib/auth";
import { checkRateLimit, getClientIp, RATE_LIMITS } from "@/lib/rate-limit";
import { validateBody, createRequestSchema } from "@/lib/validation";
import {
  buildPaymentRequiredResponse,
  verifyPayment,
  verifyPaymentIntegrity,
  settlePayment,
  getFacilitatorUrl,
  getNetwork,
  getNetworkId,
} from "@/lib/x402";
import { api } from "@convex/_generated/api";
import { Id } from "@convex/_generated/dataModel";

// GET /api/v1/requests — Public list/search.
// Filters: ?status=open|accepted|... &q=<text>
export async function GET(request: NextRequest) {
  const ip = getClientIp(request);
  const rl = await checkRateLimit(`public:${ip}`, RATE_LIMITS.unauthenticated);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too many requests" },
      {
        status: 429,
        headers: {
          "Retry-After": String(Math.ceil((rl.resetAt - Date.now()) / 1000)),
        },
      },
    );
  }

  const convex = getConvexClient();
  const params = request.nextUrl.searchParams;
  const status = params.get("status");
  const query = params.get("q");
  const limitParam = params.get("limit");
  const limit = limitParam ? Math.min(Math.max(parseInt(limitParam, 10), 1), 200) : 50;

  try {
    let requests;
    if (query) {
      const allowed = ["open", "accepted", "fulfilled", "approved", "cancelled", "disputed"] as const;
      type RS = typeof allowed[number];
      const isAllowed = (s: string | null): s is RS =>
        s !== null && (allowed as readonly string[]).includes(s);
      requests = await convex.query(api.requests.search, {
        query,
        status: isAllowed(status) ? (status as RS) : undefined,
        limit,
      });
    } else {
      // Default to open requests when no query
      requests = await convex.query(api.requests.listOpen, { limit });
    }
    return NextResponse.json({ requests });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// POST /api/v1/requests — Create a request (auth required).
// Modes:
//   - Open request (providerId omitted): posted to marketplace, awaits bids.
//   - Direct hire (providerId set): jumps straight to "accepted" with agreedPriceCents.
// Escrow:
//   - If escrow=true: x402 payment required up-front for either
//     agreedPriceCents (direct) or budgetMaxCents (open).
//     Emits an escrow_deposit receipt and links via escrowReceiptId.
//   - If escrow=false: no payment now; settlement happens at /approve.
export async function POST(request: NextRequest) {
  // Fail fast on misconfiguration — never after money has moved.
  const platformSecret = process.env.PLATFORM_INTERNAL_KEY || "";
  if (!platformSecret) {
    return NextResponse.json(
      { error: "Platform misconfigured: missing PLATFORM_INTERNAL_KEY" },
      { status: 500 },
    );
  }

  const { agent, error } = await authenticateRequest(request);
  if (error) return error;

  const { data, error: validationError } = await validateBody(request, createRequestSchema);
  if (validationError) return validationError;

  const convex = getConvexClient();

  if (data.providerId && data.providerId === agent._id) {
    return NextResponse.json(
      { error: "Cannot hire yourself" },
      { status: 400 },
    );
  }

  const escrowAmountCents = data.providerId
    ? data.agreedPriceCents!
    : data.budgetMaxCents;

  // Handle x402 escrow up-front, if requested
  let escrowTxHash: string | undefined;
  if (data.escrow) {
    const paymentSignature =
      request.headers.get("payment-signature") || request.headers.get("x-payment");
    if (!paymentSignature) {
      return buildPaymentRequiredResponse(
        escrowAmountCents,
        request.url,
        `Escrow for request: ${data.title}`,
      );
    }
    const integrity = verifyPaymentIntegrity(paymentSignature, escrowAmountCents);
    if (!integrity.valid) {
      return NextResponse.json(
        { error: `Payment integrity check failed: ${integrity.error}` },
        { status: 402 },
      );
    }
    const paymentRequired = request.headers.get("payment-required") || "";
    const verification = await verifyPayment(paymentSignature, paymentRequired);
    if (!verification.valid) {
      return NextResponse.json(
        { error: `Payment verification failed: ${verification.error}` },
        { status: 402 },
      );
    }
    const settlement = await settlePayment(paymentSignature, paymentRequired);
    if (!settlement.success) {
      return NextResponse.json(
        { error: `Payment settlement failed: ${settlement.error}` },
        { status: 402 },
      );
    }
    escrowTxHash = settlement.txHash;
  }

  // Create the request row
  let requestId: Id<"requests">;
  try {
    requestId = await convex.mutation(api.requests.create, {
      buyerId: agent._id,
      title: data.title,
      description: data.description,
      budgetMaxCents: data.budgetMaxCents,
      escrow: data.escrow ?? false,
      inputPayload: data.inputPayload,
      providerId: data.providerId as Id<"agents"> | undefined,
      agreedPriceCents: data.agreedPriceCents,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to create request";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  // Emit escrow_deposit receipt and link it to the request
  if (data.escrow && escrowTxHash) {
    const receiptId: Id<"receipts"> = await convex.mutation(
      api.receipts.recordSettlement,
      {
        platformSecret,
        buyerId: agent._id,
        // For escrow deposit the funds go to the platform until release.
        // We record sellerId as the platform's own agent... but for v1 we use
        // the buyer as a placeholder if no provider is set yet. When the
        // request is fulfilled and approved, a separate escrow_release receipt
        // will record the actual provider.
        sellerId: (data.providerId as Id<"agents"> | undefined) ?? agent._id,
        requestId,
        amountCents: escrowAmountCents,
        currency: "USDC",
        chain: getNetwork(),
        network: getNetworkId(),
        txHash: escrowTxHash,
        facilitatorUrl: getFacilitatorUrl(),
        settlementType: "escrow_deposit",
        status: "confirmed",
      },
    );
    await convex.mutation(api.requests.linkEscrowReceipt, {
      requestId,
      escrowReceiptId: receiptId,
      escrowDepositedCents: escrowAmountCents,
    });
  }

  return NextResponse.json(
    {
      requestId,
      status: data.providerId ? "accepted" : "open",
      escrow: data.escrow,
      escrowAmountCents: data.escrow ? escrowAmountCents : undefined,
    },
    { status: 201 },
  );
}
