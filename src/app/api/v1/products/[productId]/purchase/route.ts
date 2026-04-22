import { randomBytes } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { getConvexClient } from "@/lib/convex";
import { authenticateRequest } from "@/lib/auth";
import {
  buildPaymentRequiredResponse,
  verifyPayment,
  verifyPaymentIntegrity,
  settlePayment,
  getFacilitatorUrl,
  getNetwork,
  getNetworkId,
} from "@/lib/x402";
import { api } from "@convex/_generated/api";
import { Id } from "@convex/_generated/dataModel";

const DOWNLOAD_TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

// POST /api/v1/products/:productId/purchase — x402 direct pay → signed download URL
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ productId: string }> }
) {
  const { agent, error } = await authenticateRequest(request);
  if (error) return error;

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

  if (agent._id === product.sellerId) {
    return NextResponse.json(
      { error: "Sellers cannot purchase their own products" },
      { status: 400 }
    );
  }

  // Check for x402 payment header
  const paymentSignature =
    request.headers.get("payment-signature") || request.headers.get("x-payment");

  if (!paymentSignature) {
    return buildPaymentRequiredResponse(
      product.priceCents,
      request.url,
      `Payment for product: ${product.title}`
    );
  }

  const integrityCheck = verifyPaymentIntegrity(paymentSignature, product.priceCents);
  if (!integrityCheck.valid) {
    return NextResponse.json(
      { error: `Payment integrity check failed: ${integrityCheck.error}` },
      { status: 402 }
    );
  }

  const paymentRequired = request.headers.get("payment-required") || "";
  const verification = await verifyPayment(paymentSignature, paymentRequired);
  if (!verification.valid) {
    return NextResponse.json(
      { error: `Payment verification failed: ${verification.error}` },
      { status: 402 }
    );
  }

  const settlement = await settlePayment(paymentSignature, paymentRequired);
  if (!settlement.success) {
    return NextResponse.json(
      { error: `Payment settlement failed: ${settlement.error}` },
      { status: 402 }
    );
  }

  // Record transaction
  const transactionId = await convex.mutation(api.transactions.create, {
    fromAgentId: agent._id as Id<"agents">,
    toAgentId: product.sellerId,
    productId: product._id,
    amountCents: product.priceCents,
    currency: "USDC",
    chain: getNetwork(),
    network: getNetworkId(),
    txHash: settlement.txHash,
    facilitatorUrl: getFacilitatorUrl(),
    type: "direct_payment",
    status: "confirmed",
    confirmedAt: Date.now(),
  });

  // Create purchase record with TTL download token
  const downloadToken = randomBytes(32).toString("hex");
  const tokenExpiresAt = Date.now() + DOWNLOAD_TOKEN_TTL_MS;

  await convex.mutation(api.products.createPurchase, {
    productId: product._id,
    buyerId: agent._id as Id<"agents">,
    transactionId: transactionId as Id<"transactions">,
    downloadToken,
    tokenExpiresAt,
  });

  const downloadUrl = `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/api/v1/products/${productId}/download?token=${downloadToken}`;

  return NextResponse.json(
    {
      downloadUrl,
      expiresAt: new Date(tokenExpiresAt).toISOString(),
      transactionId,
      txHash: settlement.txHash,
    },
    {
      headers: {
        "X-Transaction-Id": String(transactionId),
        "X-Tx-Hash": settlement.txHash || "",
      },
    }
  );
}
