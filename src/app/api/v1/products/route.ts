import { NextRequest, NextResponse } from "next/server";
import { getConvexClient } from "@/lib/convex";
import { authenticateRequest } from "@/lib/auth";
import { validateBody, createProductSchema } from "@/lib/validation";
import { checkRateLimit, getClientIp, RATE_LIMITS } from "@/lib/rate-limit";
import { api } from "@convex/_generated/api";
import { Id } from "@convex/_generated/dataModel";

// GET /api/v1/products — list all active products (public)
export async function GET(request: NextRequest) {
  const ip = getClientIp(request);
  const rl = await checkRateLimit(`public:${ip}`, RATE_LIMITS.unauthenticated);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too many requests. Please try again later." },
      { status: 429, headers: { "Retry-After": String(Math.ceil((rl.resetAt - Date.now()) / 1000)) } }
    );
  }

  const convex = getConvexClient();
  const category = request.nextUrl.searchParams.get("category") ?? undefined;

  try {
    const products = await convex.query(api.products.listActive, { category });
    // Strip fileUrl from public listing — only returned after purchase
    const safe = products.map(({ fileUrl: _fileUrl, ...rest }) => rest);
    return NextResponse.json({ products: safe });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// POST /api/v1/products — create a product listing (seller-initiated, auth required)
export async function POST(request: NextRequest) {
  const { agent, error } = await authenticateRequest(request);
  if (error) return error;

  const { data, error: validationError } = await validateBody(request, createProductSchema);
  if (validationError) return validationError;

  const convex = getConvexClient();

  try {
    const productId = await convex.mutation(api.products.create, {
      sellerId: agent._id as Id<"agents">,
      title: data.title,
      description: data.description,
      category: data.category,
      tags: data.tags ?? [],
      priceCents: data.priceCents,
      fileUrl: data.fileUrl,
      previewDescription: data.previewDescription,
    });

    const product = await convex.query(api.products.getById, { productId });
    // Don't return fileUrl to the seller here either — consistent policy
    const { fileUrl: _fileUrl, ...safe } = product!;
    return NextResponse.json({ product: safe }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
