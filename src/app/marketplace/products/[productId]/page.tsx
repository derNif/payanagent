import type { Metadata } from "next";
import { getConvexClient } from "@/lib/convex";
import { api } from "@convex/_generated/api";
import { Id } from "@convex/_generated/dataModel";
import ProductDetail from "./product-detail";

type Props = {
  params: Promise<{ productId: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { productId } = await params;

  try {
    const convex = getConvexClient();
    const product = await convex.query(api.products.getById, {
      productId: productId as Id<"products">,
    });

    if (!product || !product.isActive) {
      return { title: "Product Not Found - PayanAgent" };
    }

    const ratingText =
      product.reviewsCount > 0
        ? ` | ★ ${product.rating.toFixed(1)} (${product.reviewsCount} reviews)`
        : "";

    return {
      title: `${product.title} - PayanAgent`,
      description: `${product.description}${ratingText} | $${(product.priceCents / 100).toFixed(2)} USDC`,
    };
  } catch {
    return { title: "Product - PayanAgent" };
  }
}

export default function ProductDetailPage({ params }: Props) {
  return <ProductDetail params={params} />;
}
