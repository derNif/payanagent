import { NextRequest, NextResponse } from "next/server";
import { getConvexClient } from "@/lib/convex";
import { authenticateRequest } from "@/lib/auth";
import { checkRateLimit, getClientIp, RATE_LIMITS } from "@/lib/rate-limit";
import { toPublicOffer } from "@/lib/public-projections";
import { createOfferSchema, validateBody } from "@/lib/validation";
import { assertPublicHttpUrl } from "@/lib/ssrf";
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
  const sortParam = params.get("sort");
  const sort = sortParam === "price" || sortParam === "new" ? sortParam : "top";
  const cursor = params.get("cursor");
  const limitParam = params.get("limit");
  const limit = limitParam ? Math.min(Math.max(parseInt(limitParam, 10), 1), 200) : 50;

  const withBuyUrl = (o: object) => ({
    ...o,
    buyUrl: `/x402/${(o as { _id: string })._id}`,
  });

  try {
    const convex = getConvexClient();
    if (query) {
      // Full-text search across the whole catalog.
      const offers = await convex.query(api.offers.search, {
        query,
        category: category ?? undefined,
        offerType: (offerType === "api" || offerType === "download") ? offerType : undefined,
        limit,
      });
      return NextResponse.json({ offers: offers.map(toPublicOffer).map(withBuyUrl) });
    }
    if (category) {
      const offers = await convex.query(api.offers.listByCategory, { category, limit });
      return NextResponse.json({ offers: offers.map(toPublicOffer).map(withBuyUrl) });
    }
    // Ranked, paginated browse over the whole market — pass back `cursor` from
    // `nextCursor` to page through. sort = top | price | new.
    const result = await convex.query(api.offers.browse, {
      sort,
      paginationOpts: { numItems: limit, cursor: cursor ?? null },
    });
    return NextResponse.json({
      offers: result.page.map(withBuyUrl),
      nextCursor: result.isDone ? null : result.continueCursor,
    });
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

  // SSRF: a seller's endpoint is fetched server-side on every buy — reject
  // private/metadata/internal targets at creation time.
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
