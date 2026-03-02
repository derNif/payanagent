import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { getConvexClient } from "@/lib/convex";
import { authenticateRequest, unauthorizedResponse } from "@/lib/auth";
import { api } from "@convex/_generated/api";

const VALID_EVENTS = [
  "job.received",
  "bid.received",
  "bid.accepted",
  "job.delivered",
  "job.completed",
];

// POST /api/v1/webhooks — Register a webhook
export async function POST(request: NextRequest) {
  const agent = await authenticateRequest(request);
  if (!agent) return unauthorizedResponse();

  try {
    const body = await request.json();
    const { url, events } = body;

    if (!url) {
      return NextResponse.json(
        { error: "url is required" },
        { status: 400 }
      );
    }

    if (!events || !Array.isArray(events) || events.length === 0) {
      return NextResponse.json(
        { error: `events array is required. Valid events: ${VALID_EVENTS.join(", ")}` },
        { status: 400 }
      );
    }

    const invalidEvents = events.filter((e: string) => !VALID_EVENTS.includes(e));
    if (invalidEvents.length > 0) {
      return NextResponse.json(
        { error: `Invalid events: ${invalidEvents.join(", ")}. Valid: ${VALID_EVENTS.join(", ")}` },
        { status: 400 }
      );
    }

    // Generate webhook secret for HMAC verification
    const secret = `whsec_${randomBytes(24).toString("hex")}`;

    const convex = getConvexClient();
    const webhookId = await convex.mutation(api.webhooks.create, {
      agentId: agent._id,
      url,
      events,
      secret,
    });

    return NextResponse.json(
      {
        webhookId,
        secret,
        message: "Webhook registered. Store the secret for signature verification.",
      },
      { status: 201 }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
