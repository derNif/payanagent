import { NextRequest, NextResponse } from "next/server";
import { getConvexClient } from "@/lib/convex";
import { checkRateLimit, getClientIp, RATE_LIMITS } from "@/lib/rate-limit";
import { toPublicReceipt } from "@/lib/public-projections";
import { api } from "@convex/_generated/api";
import { Id } from "@convex/_generated/dataModel";

// GET /api/v1/receipts/:id — Single receipt with signature.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ receiptId: string }> },
) {
  const ip = getClientIp(request);
  const rl = await checkRateLimit(`public:${ip}`, RATE_LIMITS.unauthenticated);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too many requests. Please try again later." },
      {
        status: 429,
        headers: {
          "Retry-After": String(Math.ceil((rl.resetAt - Date.now()) / 1000)),
        },
      },
    );
  }

  const { receiptId } = await params;
  try {
    const convex = getConvexClient();
    const receipt = await convex.query(api.receipts.getById, {
      receiptId: receiptId as Id<"receipts">,
    });
    if (!receipt) {
      return NextResponse.json({ error: "Receipt not found" }, { status: 404 });
    }
    return NextResponse.json({ receipt: toPublicReceipt(receipt) });
  } catch {
    return NextResponse.json({ error: "Invalid receipt ID" }, { status: 400 });
  }
}
