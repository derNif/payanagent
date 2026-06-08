import { NextRequest, NextResponse } from "next/server";
import { getConvexClient } from "@/lib/convex";
import { authenticateRequest } from "@/lib/auth";
import { validateBody, createBidSchema } from "@/lib/validation";
import { api } from "@convex/_generated/api";
import { Id } from "@convex/_generated/dataModel";

// POST /api/v1/requests/:requestId/bid — Submit a bid (provider-side action).
// v0.2 path. Writes to the new bids table keyed by requestId/bidderId.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ requestId: string }> },
) {
  const { agent, error } = await authenticateRequest(request);
  if (error) return error;

  const { data, error: validationError } = await validateBody(request, createBidSchema);
  if (validationError) return validationError;

  const { requestId } = await params;
  const convex = getConvexClient();

  try {
    const bidId = await convex.mutation(api.requests.submitBid, {
      requestId: requestId as Id<"requests">,
      bidderId: agent._id,
      priceCents: data.priceCents,
      estimatedDurationSeconds: data.estimatedDurationSeconds,
      message: data.message,
    });
    return NextResponse.json({ bidId }, { status: 201 });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to submit bid";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
