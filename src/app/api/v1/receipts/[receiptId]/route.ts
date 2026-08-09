import { NextRequest, NextResponse } from "next/server";
import { getConvexClient } from "@/lib/convex";
import { enforceIpRateLimit, jsonError } from "@/lib/api-http";
import { RATE_LIMITS } from "@/lib/rate-limit";
import { toPublicReceipt } from "@/lib/public-projections";
import { cacheHeaders } from "@/lib/cache";
import { api } from "@convex/_generated/api";
import { Id } from "@convex/_generated/dataModel";

// GET /api/v1/receipts/:id — Single receipt with signature.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ receiptId: string }> },
) {
  const limited = await enforceIpRateLimit(
    request,
    "public",
    RATE_LIMITS.unauthenticated,
  );
  if (limited) return limited;

  const { receiptId } = await params;
  try {
    const convex = getConvexClient();
    const receipt = await convex.query(api.receipts.getById, {
      receiptId: receiptId as Id<"receipts">,
    });
    if (!receipt) {
      return jsonError("Receipt not found", 404);
    }
    return NextResponse.json(
      { receipt: toPublicReceipt(receipt) },
      { headers: cacheHeaders(300) },
    );
  } catch {
    return jsonError("Invalid receipt ID", 400);
  }
}
