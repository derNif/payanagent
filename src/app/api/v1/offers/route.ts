import { NextRequest, NextResponse } from "next/server";
import { getConvexClient } from "@/lib/convex";
import { authenticateRequest } from "@/lib/auth";
import { checkRateLimit, getClientIp, RATE_LIMITS } from "@/lib/rate-limit";
import { toPublicOffer } from "@/lib/public-projections";
import { createOfferSchema, validateBody } from "@/lib/validation";
import { api } from "@convex/_generated/api";

// GET /api/v1/offers — Public list/search.
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

  const params = request.nextUrl.searchParams;
  const query = params.get("q");
  const category = params.get("category");
  const offerType = params.get("offerType");
  const limitParam = params.get("limit");
  const limit = limitParam ? Math.min(Math.max(parseInt(limitParam, 10), 1), 200) : 50;

  try {
    const convex = getConvexClient();
    let offers;
    if (query) {
      offers = await convex.query(api.offers.search, {
        query,
        category: category ?? undefined,
        offerType: (offerType === "api" || offerType === "download") ? offerType : undefined,
        limit,
      });
    } else if (category) {
      offers = await convex.query(api.offers.listByCategory, { category, limit });
    } else {
      offers = await convex.query(api.offers.listActive, {
        offerType: (offerType === "api" || offerType === "download") ? offerType : undefined,
        limit,
      });
    }
    return NextResponse.json({ offers: offers.map(toPublicOffer) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// POST /api/v1/offers — Create offer (auth required).
export async function POST(request: NextRequest) {
  const { agent, error } = await authenticateRequest(request);
  if (error) return error;

  const { data, error: validationError } = await validateBody(request, createOfferSchema);
  if (validationError) return validationError;

  try {
    const convex = getConvexClient();
    const offerId = await convex.mutation(api.offers.create, {
      sellerId: agent._id,
      title: data.title,
      description: data.description,
      category: data.category,
      tags: data.tags ?? [],
      priceCents: data.priceCents,
      offerType: data.offerType,
      endpoint: data.endpoint,
      httpMethod: data.httpMethod,
      inputSchema: data.inputSchema,
      outputSchema: data.outputSchema,
      estimatedDurationSeconds: data.estimatedDurationSeconds,
      fileUrl: data.fileUrl,
      previewDescription: data.previewDescription,
    });
    return NextResponse.json({ offerId }, { status: 201 });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to create offer";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
