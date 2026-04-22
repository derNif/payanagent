import { NextRequest, NextResponse } from "next/server";
import { getConvexClient } from "@/lib/convex";
import { api } from "@convex/_generated/api";
import { Id } from "@convex/_generated/dataModel";

// GET /api/v1/products/:productId/download?token=... — verify TTL token, redirect to fileUrl
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ productId: string }> }
) {
  const { productId } = await params;
  const token = request.nextUrl.searchParams.get("token");

  if (!token) {
    return NextResponse.json({ error: "Missing download token" }, { status: 400 });
  }

  const convex = getConvexClient();

  const purchase = await convex.query(api.products.getPurchaseByToken, {
    downloadToken: token,
  });

  if (!purchase) {
    return NextResponse.json({ error: "Invalid or expired download token" }, { status: 404 });
  }

  if (purchase.productId !== productId) {
    return NextResponse.json({ error: "Token does not match product" }, { status: 400 });
  }

  if (Date.now() > purchase.tokenExpiresAt) {
    return NextResponse.json(
      { error: "Download token has expired. Please purchase again." },
      { status: 410 }
    );
  }

  let product;
  try {
    product = await convex.query(api.products.getById, {
      productId: productId as Id<"products">,
    });
  } catch {
    return NextResponse.json({ error: "Invalid product ID" }, { status: 400 });
  }

  if (!product) {
    return NextResponse.json({ error: "Product not found" }, { status: 404 });
  }

  // Record first download timestamp (fire and forget)
  if (!purchase.downloadedAt) {
    convex.mutation(api.products.markDownloaded, {
      purchaseId: purchase._id,
    });
  }

  return NextResponse.redirect(product.fileUrl, { status: 302 });
}
