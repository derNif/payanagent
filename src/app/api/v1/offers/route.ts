import { NextRequest, NextResponse } from "next/server";
import { getConvexClient, PLATFORM_SECRET } from "@/lib/convex";
import { authenticateRequest } from "@/lib/auth";
import { checkRateLimit, getClientIp, RATE_LIMITS } from "@/lib/rate-limit";
import { toPublicOffer } from "@/lib/public-projections";
import { cacheHeaders } from "@/lib/cache";
import { createOfferSchema, validateBody } from "@/lib/validation";
import { assertPublicHttpUrl } from "@/lib/ssrf";
import { probeX402Resource } from "@/lib/external-verify";
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
      return NextResponse.json(
        { offers: offers.map(toPublicOffer).map(withBuyUrl) },
        { headers: cacheHeaders(300) },
      );
    }
    if (category) {
      const offers = await convex.query(api.offers.listByCategory, { category, limit });
      return NextResponse.json(
        { offers: offers.map(toPublicOffer).map(withBuyUrl) },
        { headers: cacheHeaders(300) },
      );
    }
    // Ranked, paginated browse over the whole market — pass back `cursor` from
    // `nextCursor` to page through. sort = top | price | new.
    const result = await convex.query(api.offers.browse, {
      sort,
      paginationOpts: { numItems: limit, cursor: cursor ?? null },
    });
    return NextResponse.json(
      {
        offers: result.page.map(withBuyUrl),
        nextCursor: result.isDone ? null : result.continueCursor,
      },
      { headers: cacheHeaders(300) },
    );
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

  const convex = getConvexClient();

  // Relay mode (issue #95): the seller's API is already x402-gated, so
  // PayanAgent must NOT settle a second payment — buys are relayed to the
  // resource's own 402 (relayExternalBuy). Registration verifies the challenge
  // server-side and binds it to the caller: the resource's payTo must be the
  // registering agent's wallet, which is also what makes claiming an
  // already-ingested catalog URL legitimate.
  if (data.externalUrl) {
    if (!agent.walletAddress) {
      return NextResponse.json(
        { error: "Relay offers require the agent to have a walletAddress" },
        { status: 400 },
      );
    }
    let terms;
    try {
      terms = await probeX402Resource(data.externalUrl, data.httpMethod ?? "GET");
    } catch (err) {
      const message = err instanceof Error ? err.message : "verification failed";
      return NextResponse.json(
        { error: `externalUrl verification failed: ${message}` },
        { status: 400 },
      );
    }
    if (terms.payTo.toLowerCase() !== agent.walletAddress.toLowerCase()) {
      return NextResponse.json(
        {
          error: `externalUrl pays ${terms.payTo}, but this agent's wallet is ${agent.walletAddress}. Register from the agent that owns the receiving wallet.`,
        },
        { status: 403 },
      );
    }
    try {
      const offerId = await convex.mutation(api.offers.registerExternal, {
        platformSecret: PLATFORM_SECRET,
        sellerId: agent._id,
        externalUrl: data.externalUrl,
        title: data.title,
        description: data.description,
        category: data.category,
        tags: data.tags ?? [],
        priceCents: Math.round(Number(terms.amountRaw) / 10000),
        httpMethod: data.httpMethod,
        inputSchema: data.inputSchema,
        outputSchema: data.outputSchema,
        estimatedDurationSeconds: data.estimatedDurationSeconds,
        previewDescription: data.previewDescription,
        payTo: terms.payTo,
        asset: terms.asset,
        network: terms.network,
        amountRaw: terms.amountRaw,
      });
      return NextResponse.json(
        {
          offerId,
          mode: "relay",
          buyUrl: `/x402/${offerId}`,
          verified: terms,
        },
        { status: 201 },
      );
    } catch (e) {
      const message = e instanceof Error ? e.message : "Failed to register offer";
      return NextResponse.json({ error: message }, { status: 400 });
    }
  }

  try {
    const offerId = await convex.mutation(api.offers.create, {
      platformSecret: PLATFORM_SECRET,
      sellerId: agent._id,
      title: data.title,
      description: data.description,
      category: data.category,
      tags: data.tags ?? [],
      // The externalUrl branch returned above, so priceCents is present here
      // (enforced by createOfferSchema).
      priceCents: data.priceCents!,
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
