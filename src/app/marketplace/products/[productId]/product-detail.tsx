"use client";

import { use } from "react";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { Id } from "@convex/_generated/dataModel";
import Link from "next/link";
import { notFound } from "next/navigation";

type Props = {
  params: Promise<{ productId: string }>;
};

export default function ProductDetail({ params }: Props) {
  const { productId } = use(params);
  const product = useQuery(api.products.getById, {
    productId: productId as Id<"products">,
  });

  if (product === undefined) {
    return <div className="text-muted-foreground">Loading...</div>;
  }

  if (!product || !product.isActive) {
    notFound();
  }

  const purchaseEndpoint = `/api/v1/products/${productId}/purchase`;

  return (
    <div className="max-w-2xl">
      <div className="mb-6">
        <Link
          href="/marketplace/products"
          className="text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          ← Products
        </Link>
      </div>

      <div className="bg-card border border-border rounded-xl p-8">
        <div className="flex items-start justify-between mb-6">
          <div className="flex-1 min-w-0">
            <h1 className="text-2xl font-bold text-foreground mb-2">
              {product.title}
            </h1>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs bg-secondary text-muted-foreground px-2 py-0.5 rounded">
                {product.category}
              </span>
              <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded">
                {product.deliveryMode}
              </span>
              {product.reviewsCount > 0 && (
                <span className="text-xs text-muted-foreground">
                  ★ {product.rating.toFixed(1)} ({product.reviewsCount}{" "}
                  {product.reviewsCount === 1 ? "review" : "reviews"})
                </span>
              )}
            </div>
          </div>
          <div className="text-right ml-6 shrink-0">
            <p className="text-3xl font-mono text-primary">
              ${(product.priceCents / 100).toFixed(2)}
            </p>
            <p className="text-sm text-muted-foreground/60">USDC</p>
          </div>
        </div>

        <p className="text-sm text-muted-foreground mb-6">
          {product.description}
        </p>

        {product.previewDescription && (
          <div className="bg-secondary/30 border border-border rounded-lg p-4 mb-6">
            <p className="text-xs font-medium text-muted-foreground mb-1">
              Preview
            </p>
            <p className="text-sm text-foreground">{product.previewDescription}</p>
          </div>
        )}

        {product.tags.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-6">
            {product.tags.map((tag) => (
              <span
                key={tag}
                className="text-xs bg-secondary/50 text-muted-foreground/60 px-1.5 py-0.5 rounded"
              >
                {tag}
              </span>
            ))}
          </div>
        )}

        <div className="border-t border-border pt-6">
          <h3 className="text-sm font-medium text-foreground mb-2">
            Purchase via API
          </h3>
          <p className="text-xs text-muted-foreground mb-3">
            Purchases are made via the x402 protocol using your agent API key.
            On success you receive a signed download URL valid for 24 hours.
          </p>
          <pre className="bg-background/50 border border-border rounded-lg p-4 text-xs font-mono overflow-x-auto text-muted-foreground whitespace-pre">
{`POST ${purchaseEndpoint}
Authorization: Bearer <your-api-key>
# x402 client sends payment headers automatically`}
          </pre>
          <p className="text-xs text-muted-foreground/60 mt-3">
            Response includes{" "}
            <code className="bg-secondary px-1 rounded">downloadUrl</code>,{" "}
            <code className="bg-secondary px-1 rounded">expiresAt</code>, and{" "}
            <code className="bg-secondary px-1 rounded">txHash</code>.
          </p>
        </div>
      </div>
    </div>
  );
}
