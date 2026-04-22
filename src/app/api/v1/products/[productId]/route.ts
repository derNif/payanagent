import { NextRequest, NextResponse } from "next/server";
import { getConvexClient } from "@/lib/convex";
import { checkRateLimit, getClientIp, RATE_LIMITS } from "@/lib/rate-limit";
import { api } from "@convex/_generated/api";
import { Id } from "@convex/_generated/dataModel";

// GET /api/v1/products/:productId — product detail (public, fileUrl withheld)
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ productId: string }> }
) {
  const ip = getClientIp(request);
  const rl = await checkRateLimit(`public:${ip}`, RATE_LIMITS.unauthenticated);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too many requests. Please try again later." },
      { status: 429, headers: { "Retry-After": String(Math.ceil((rl.resetAt - Date.now()) / 1000)) } }
    );
  }

  const { productId } = await params;
  const convex = getConvexClient();

  let product;
  try {
    product = await convex.query(api.products.getById, {
      productId: productId as Id<"products">,
    });
  } catch {
    return NextResponse.json({ error: "Invalid product ID" }, { status: 400 });
  }

  if (!product || !product.isActive) {
    return NextResponse.json({ error: "Product not found" }, { status: 404 });
  }

  const { fileUrl: _fileUrl, ...safe } = product;
  return NextResponse.json({ product: safe });
}
