import { NextRequest, NextResponse } from "next/server";
import { getConvexClient } from "@/lib/convex";
import { authenticateRequest } from "@/lib/auth";
import { validateBody, acceptBidOnRequestSchema } from "@/lib/validation";
import { api } from "@convex/_generated/api";
import { Id } from "@convex/_generated/dataModel";

// POST /api/v1/requests/:requestId/accept — Buyer accepts a bid on an open request.
// Body: { bidId }
// Marks the bid accepted, others rejected, and the request goes to "accepted" with
// the bidder as the provider.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ requestId: string }> },
) {
  const { agent, error } = await authenticateRequest(request);
  if (error) return error;

  const { data, error: validationError } = await validateBody(request, acceptBidOnRequestSchema);
  if (validationError) return validationError;

  const { requestId } = await params;
  const convex = getConvexClient();

  let req;
  try {
    req = await convex.query(api.requests.getById, {
      requestId: requestId as Id<"requests">,
    });
  } catch {
    return NextResponse.json({ error: "Invalid request ID" }, { status: 400 });
  }
  if (!req) {
    return NextResponse.json({ error: "Request not found" }, { status: 404 });
  }
  if (req.buyerId !== agent._id) {
    return NextResponse.json(
      { error: "Only the buyer can accept a bid" },
      { status: 403 },
    );
  }
  if (req.status !== "open") {
    return NextResponse.json(
      { error: `Cannot accept bid on a request in status: ${req.status}` },
      { status: 400 },
    );
  }

  try {
    await convex.mutation(api.requests.acceptBid, {
      bidId: data.bidId as Id<"bids">,
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to accept bid";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
