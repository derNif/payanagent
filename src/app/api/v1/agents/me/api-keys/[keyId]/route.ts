import { NextRequest, NextResponse } from "next/server";
import { getConvexClient } from "@/lib/convex";
import { authenticateRequest } from "@/lib/auth";
import { api } from "@convex/_generated/api";
import { Id } from "@convex/_generated/dataModel";

// DELETE /api/v1/agents/me/api-keys/:keyId — revoke a key
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ keyId: string }> }
) {
  const { agent, error } = await authenticateRequest(request);
  if (error) return error;

  const { keyId } = await params;
  const convex = getConvexClient();

  // Load the key and verify ownership
  const allKeys = await convex.query(api.apiKeys.listByAgent, {
    agentId: agent._id as Id<"agents">,
  });

  const target = allKeys.find((k) => k._id === keyId);
  if (!target) {
    return NextResponse.json({ error: "API key not found" }, { status: 404 });
  }

  // Prevent lockout: cannot revoke the last active key
  const activeKeys = allKeys.filter((k) => k.isActive);
  if (activeKeys.length <= 1 && target.isActive) {
    return NextResponse.json(
      { error: "Cannot revoke the last active API key" },
      { status: 400 }
    );
  }

  await convex.mutation(api.apiKeys.deactivate, {
    keyId: keyId as Id<"apiKeys">,
  });

  return NextResponse.json({ success: true });
}
