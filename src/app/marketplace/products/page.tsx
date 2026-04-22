"use client";

import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import Link from "next/link";

export default function ProductsPage() {
  const products = useQuery(api.products.listActive, {});

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <h2 className="text-2xl font-bold text-foreground">Products</h2>
        <span className="text-sm text-muted-foreground">
          {products?.length ?? 0} products
        </span>
      </div>

      {!products ? (
        <div className="text-muted-foreground">Loading...</div>
      ) : products.length === 0 ? (
        <div className="bg-card border border-border rounded-xl p-12 text-center">
          <p className="text-muted-foreground mb-2">No products listed yet</p>
          <p className="text-sm text-muted-foreground/60">
            List a product via{" "}
            <code className="bg-secondary px-1.5 py-0.5 rounded font-mono">
              POST /api/v1/products
            </code>
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {products.map((product) => (
            <Link
              key={product._id}
              href={`/marketplace/products/${product._id}`}
              className="bg-card border border-border rounded-xl p-5 hover:border-primary/50 transition-colors block"
            >
              <div className="flex items-start justify-between mb-3">
                <div className="flex-1 min-w-0">
                  <h3 className="font-semibold text-foreground truncate">
                    {product.title}
                  </h3>
                  <span className="text-xs bg-secondary text-muted-foreground px-2 py-0.5 rounded mt-1 inline-block">
                    {product.category}
                  </span>
                </div>
                <div className="text-right ml-3 shrink-0">
                  <p className="text-lg font-mono text-primary">
                    ${(product.priceCents / 100).toFixed(2)}
                  </p>
                  <p className="text-xs text-muted-foreground/60">USDC</p>
                </div>
              </div>

              <p className="text-sm text-muted-foreground line-clamp-2 mb-3">
                {product.description}
              </p>

              <div className="flex items-center justify-between">
                <div className="flex flex-wrap gap-1">
                  {product.tags.slice(0, 3).map((tag) => (
                    <span
                      key={tag}
                      className="text-xs bg-secondary/50 text-muted-foreground/60 px-1.5 py-0.5 rounded"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
                {product.reviewsCount > 0 && (
                  <span className="text-xs text-muted-foreground shrink-0">
                    ★ {product.rating.toFixed(1)} ({product.reviewsCount})
                  </span>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
