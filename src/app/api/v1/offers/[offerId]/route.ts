import { NextRequest, NextResponse } from "next/server";
import { getConvexClient, PLATFORM_SECRET } from "@/lib/convex";
import { authenticateRequest } from "@/lib/auth";
import {
  enforceIpRateLimit,
  errorMessage,
  errorResponse,
  jsonError,
} from "@/lib/api-http";
import { RATE_LIMITS } from "@/lib/rate-limit";
import { toPublicOffer } from "@/lib/public-projections";
import { cacheHeaders } from "@/lib/cache";
import { updateOfferSchema, validateBody } from "@/lib/validation";
import { assertPublicHttpUrl } from "@/lib/ssrf";
import { api } from "@convex/_generated/api";
import { Id } from "@convex/_generated/dataModel";

// GET /api/v1/offers/:id — Public offer detail.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ offerId: string }> },
) {
  const limited = await enforceIpRateLimit(
    request,
    "public",
    RATE_LIMITS.unauthenticated,
    "Too many requests",
  );
  if (limited) return limited;

  const { offerId } = await params;
  try {
    const convex = getConvexClient();
    const offer = await convex.query(api.offers.getById, {
      offerId: offerId as Id<"offers">,
    });
    if (!offer) {
      return jsonError("Offer not found", 404);
    }
    return NextResponse.json(
      { offer: toPublicOffer(offer) },
      { headers: cacheHeaders(3600) },
    );
  } catch {
    return jsonError("Invalid offer ID", 400);
  }
}

// PATCH /api/v1/offers/:id — Update offer (seller only).
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ offerId: string }> },
) {
  const { agent, error } = await authenticateRequest(request);
  if (error) return error;

  const { offerId } = await params;
  const convex = getConvexClient();
  let offer;
  try {
    offer = await convex.query(api.offers.getById, {
      offerId: offerId as Id<"offers">,
    });
  } catch {
    return jsonError("Invalid offer ID", 400);
  }
  if (!offer) {
    return jsonError("Offer not found", 404);
  }
  if (offer.sellerId !== agent._id) {
    return jsonError("Only the seller can update this offer", 403);
  }

  const { data, error: validationError } = await validateBody(request, updateOfferSchema);
  if (validationError) return validationError;

  if (data.endpoint) {
    try {
      await assertPublicHttpUrl(data.endpoint);
    } catch (err) {
      return jsonError(
        `endpoint not allowed: ${errorMessage(err, "invalid endpoint")}`,
        400,
      );
    }
  }

  try {
    await convex.mutation(api.offers.update, {
      platformSecret: PLATFORM_SECRET,
      offerId: offerId as Id<"offers">,
      ...data,
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e, "Failed to update offer", 400);
  }
}

// DELETE /api/v1/offers/:id — Deactivate offer (seller only).
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ offerId: string }> },
) {
  const { agent, error } = await authenticateRequest(request);
  if (error) return error;

  const { offerId } = await params;
  const convex = getConvexClient();
  let offer;
  try {
    offer = await convex.query(api.offers.getById, {
      offerId: offerId as Id<"offers">,
    });
  } catch {
    return jsonError("Invalid offer ID", 400);
  }
  if (!offer) {
    return jsonError("Offer not found", 404);
  }
  if (offer.sellerId !== agent._id) {
    return jsonError("Only the seller can delete this offer", 403);
  }

  await convex.mutation(api.offers.deactivate, {
      platformSecret: PLATFORM_SECRET,
    offerId: offerId as Id<"offers">,
  });
  return NextResponse.json({ ok: true });
}
