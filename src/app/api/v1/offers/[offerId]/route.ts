import { NextRequest, NextResponse } from "next/server";
import { getConvexClient } from "@/lib/convex";
import { authenticateRequest } from "@/lib/auth";
import { checkRateLimit, getClientIp, RATE_LIMITS } from "@/lib/rate-limit";
import { toPublicOffer } from "@/lib/public-projections";
import { updateOfferSchema, validateBody } from "@/lib/validation";
import { assertPublicHttpUrl } from "@/lib/ssrf";
import { api } from "@convex/_generated/api";
import { Id } from "@convex/_generated/dataModel";

// GET /api/v1/offers/:id — Public offer detail.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ offerId: string }> },
) {
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

  const { offerId } = await params;
  try {
    const convex = getConvexClient();
    const offer = await convex.query(api.offers.getById, {
      offerId: offerId as Id<"offers">,
    });
    if (!offer) {
      return NextResponse.json({ error: "Offer not found" }, { status: 404 });
    }
    return NextResponse.json({ offer: toPublicOffer(offer) });
  } catch {
    return NextResponse.json({ error: "Invalid offer ID" }, { status: 400 });
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
    return NextResponse.json({ error: "Invalid offer ID" }, { status: 400 });
  }
  if (!offer) {
    return NextResponse.json({ error: "Offer not found" }, { status: 404 });
  }
  if (offer.sellerId !== agent._id) {
    return NextResponse.json(
      { error: "Only the seller can update this offer" },
      { status: 403 },
    );
  }

  const { data, error: validationError } = await validateBody(request, updateOfferSchema);
  if (validationError) return validationError;

  if (data.endpoint) {
    try {
      await assertPublicHttpUrl(data.endpoint);
    } catch (err) {
      const message = err instanceof Error ? err.message : "invalid endpoint";
      return NextResponse.json(
        { error: `endpoint not allowed: ${message}` },
        { status: 400 },
      );
    }
  }

  try {
    await convex.mutation(api.offers.update, {
      offerId: offerId as Id<"offers">,
      ...data,
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to update offer";
    return NextResponse.json({ error: message }, { status: 400 });
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
    return NextResponse.json({ error: "Invalid offer ID" }, { status: 400 });
  }
  if (!offer) {
    return NextResponse.json({ error: "Offer not found" }, { status: 404 });
  }
  if (offer.sellerId !== agent._id) {
    return NextResponse.json(
      { error: "Only the seller can delete this offer" },
      { status: 403 },
    );
  }

  await convex.mutation(api.offers.deactivate, {
    offerId: offerId as Id<"offers">,
  });
  return NextResponse.json({ ok: true });
}
