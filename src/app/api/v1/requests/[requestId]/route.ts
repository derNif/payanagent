import { NextRequest, NextResponse } from "next/server";
import { getConvexClient, PLATFORM_SECRET } from "@/lib/convex";
import { authenticateRequest } from "@/lib/auth";
import { checkRateLimit, getClientIp, RATE_LIMITS } from "@/lib/rate-limit";
import { api } from "@convex/_generated/api";
import { Id } from "@convex/_generated/dataModel";

// GET /api/v1/requests/:requestId — request detail + bids.
//
// The work-product payloads are paywalled: `inputPayload`/`outputPayload` are
// NEVER in the public response. If the caller authenticates as a party, they
// see only what they're entitled to:
//   - assigned provider: inputPayload (to do the work) + their own outputPayload
//   - buyer: inputPayload, and outputPayload only after `approved` (i.e. paid)
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ requestId: string }> },
) {
  const { requestId } = await params;
  const convex = getConvexClient();

  // Optional auth: a Bearer key unlocks party-scoped payloads. No key = public
  // (rate-limited) view with payloads stripped.
  const authHeader = request.headers.get("authorization");
  let viewerId: Id<"agents"> | null = null;
  if (authHeader?.startsWith("Bearer ")) {
    const { agent, error } = await authenticateRequest(request);
    if (error) return error;
    viewerId = agent._id;
  } else {
    const ip = getClientIp(request);
    const rl = await checkRateLimit(`public:${ip}`, RATE_LIMITS.unauthenticated);
    if (!rl.allowed) {
      return NextResponse.json(
        { error: "Too many requests" },
        {
          status: 429,
          headers: {
            "Retry-After": String(Math.ceil((rl.resetAt - Date.now()) / 1000)),
          },
        },
      );
    }
  }

  try {
    const result = await convex.query(api.requests.getWithBids, {
      requestId: requestId as Id<"requests">,
    });
    if (!result.request) {
      return NextResponse.json({ error: "Request not found" }, { status: 404 });
    }

    const req = result.request; // already payload-stripped
    let inputPayload: string | undefined;
    let outputPayload: string | undefined;

    if (viewerId) {
      const isBuyer = String(req.buyerId) === String(viewerId);
      const isProvider =
        !!req.providerId && String(req.providerId) === String(viewerId);
      if (isBuyer || isProvider) {
        const full = await convex.query(api.requests.getFullInternal, {
          platformSecret: PLATFORM_SECRET,
          requestId: requestId as Id<"requests">,
        });
        if (full) {
          inputPayload = full.inputPayload;
          // Buyer sees the deliverable only once they've paid (approved).
          if (isProvider || req.status === "approved") {
            outputPayload = full.outputPayload;
          }
        }
      }
    }

    return NextResponse.json({
      request: { ...req, inputPayload, outputPayload },
      bids: result.bids,
    });
  } catch {
    return NextResponse.json({ error: "Invalid request ID" }, { status: 400 });
  }
}
