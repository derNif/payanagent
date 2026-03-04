import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { getConvexClient } from "@/lib/convex";
import { authenticateRequest } from "@/lib/auth";
import { validateBody, webhookSchema } from "@/lib/validation";
import { api } from "@convex/_generated/api";

// POST /api/v1/webhooks — Register a webhook
export async function POST(request: NextRequest) {
  const { agent, error } = await authenticateRequest(request);
  if (error) return error;

  try {
    const { data, error: validationError } = await validateBody(request, webhookSchema);
    if (validationError) return validationError;

    const { url, events } = data;

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
