import { NextRequest, NextResponse } from "next/server";
import { getConvexClient, requirePlatformSecret } from "@/lib/convex";
import { authenticateRequest } from "@/lib/auth";
import {
  enforceIpRateLimit,
  errorResponse,
  jsonError,
  parseLimit,
} from "@/lib/api-http";
import { RATE_LIMITS } from "@/lib/rate-limit";
import { validateBody, createRequestSchema } from "@/lib/validation";
import { cacheHeaders } from "@/lib/cache";
import { buildPaymentRequiredResponse } from "@/lib/x402";
import { getPaymentSignature, settleSignedPayment } from "@/lib/x402-settle";
import { recordSettlementReceipt } from "@/lib/settlement";
import { api } from "@convex/_generated/api";
import { Id } from "@convex/_generated/dataModel";

// GET /api/v1/requests — Public list/search.
// Filters: ?status=open|accepted|... &q=<text>
export async function GET(request: NextRequest) {
  const limited = await enforceIpRateLimit(
    request,
    "public",
    RATE_LIMITS.unauthenticated,
    "Too many requests",
  );
  if (limited) return limited;

  const convex = getConvexClient();
  const params = request.nextUrl.searchParams;
  const status = params.get("status");
  const query = params.get("q");
  const limit = parseLimit(params.get("limit"));

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
    return NextResponse.json({ requests }, { headers: cacheHeaders(120) });
  } catch (error) {
    return errorResponse(error, "Internal server error", 500);
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
  const { secret: platformSecret, error: secretError } = requirePlatformSecret();
  if (secretError) return secretError;

  const { agent, error } = await authenticateRequest(request);
  if (error) return error;

  const { data, error: validationError } = await validateBody(request, createRequestSchema);
  if (validationError) return validationError;

  const convex = getConvexClient();

  if (data.providerId && data.providerId === agent._id) {
    return jsonError("Cannot hire yourself", 400);
  }

  const escrowAmountCents = data.providerId
    ? data.agreedPriceCents!
    : data.budgetMaxCents;

  // Handle x402 escrow up-front, if requested
  let escrowTxHash: string | undefined;
  if (data.escrow) {
    const paymentSignature = getPaymentSignature(request);
    if (!paymentSignature) {
      return buildPaymentRequiredResponse(
        escrowAmountCents,
        request.url,
        `Escrow for request: ${data.title}`,
      );
    }
    const settlement = await settleSignedPayment({
      request,
      paymentSignature,
      amountCents: escrowAmountCents,
    });
    if (!settlement.ok) return settlement.response;
    escrowTxHash = settlement.txHash;
  }

  // Create the request row
  let requestId: Id<"requests">;
  try {
    requestId = await convex.mutation(api.requests.create, {
        platformSecret,
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
    return errorResponse(e, "Failed to create request");
  }

  // Emit escrow_deposit receipt and link it to the request
  if (data.escrow && escrowTxHash) {
    const receiptId = await recordSettlementReceipt(convex, {
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
      amountMicroUsd: escrowAmountCents * 10000,
      txHash: escrowTxHash,
      settlementType: "escrow_deposit",
    });
    await convex.mutation(api.requests.linkEscrowReceipt, {
        platformSecret,
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
