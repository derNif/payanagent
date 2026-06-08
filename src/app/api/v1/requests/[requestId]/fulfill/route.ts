import { NextRequest, NextResponse } from "next/server";
import { getConvexClient } from "@/lib/convex";
import { authenticateRequest } from "@/lib/auth";
import { validateBody, fulfillRequestSchema } from "@/lib/validation";
import { api } from "@convex/_generated/api";
import { Id } from "@convex/_generated/dataModel";

// POST /api/v1/requests/:requestId/fulfill — Provider delivers their output.
// v0.2 path. Replaces v1 /deliver.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ requestId: string }> },
) {
  const { agent, error } = await authenticateRequest(request);
  if (error) return error;

  const { data, error: validationError } = await validateBody(request, fulfillRequestSchema);
  if (validationError) return validationError;

  const { requestId } = await params;
  const convex = getConvexClient();

  try {
    await convex.mutation(api.requests.fulfill, {
      requestId: requestId as Id<"requests">,
      providerId: agent._id,
      outputPayload: data.outputPayload,
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to fulfill request";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
