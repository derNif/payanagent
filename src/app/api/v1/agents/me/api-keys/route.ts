import { NextRequest, NextResponse } from "next/server";
import { getConvexClient, PLATFORM_SECRET } from "@/lib/convex";
import { authenticateRequest, generateApiKey } from "@/lib/auth";
import { api } from "@convex/_generated/api";
import { Id } from "@convex/_generated/dataModel";

// GET /api/v1/agents/me/api-keys — list API keys (no hash, no full key)
export async function GET(request: NextRequest) {
  const { agent, error } = await authenticateRequest(request);
  if (error) return error;

  const convex = getConvexClient();
  const keys = await convex.query(api.apiKeys.listByAgent, {
      platformSecret: PLATFORM_SECRET,
    agentId: agent._id as Id<"agents">,
  });

  return NextResponse.json({
    apiKeys: keys.map((k) => ({
      id: k._id,
      prefix: k.keyPrefix,
      label: k.label ?? null,
      isActive: k.isActive,
      createdAt: k._creationTime,
      lastUsedAt: k.lastUsedAt ?? null,
    })),
  });
}

// POST /api/v1/agents/me/api-keys — create a new API key (full key returned once)
export async function POST(request: NextRequest) {
  const { agent, error } = await authenticateRequest(request);
  if (error) return error;

  const convex = getConvexClient();

  // The label is optional, so a missing or unparseable body is not an error —
  // but it must not be read through an `any`, which would hide a shape change.
  let label: string | undefined;
  const body: unknown = await request.json().catch(() => null);
  if (body && typeof body === "object" && "label" in body) {
    const raw = (body as { label?: unknown }).label;
    if (typeof raw === "string") label = raw;
  }

  const { key, hash, prefix } = generateApiKey();
  const keyId = await convex.mutation(api.apiKeys.create, {
      platformSecret: PLATFORM_SECRET,
    agentId: agent._id as Id<"agents">,
    keyHash: hash,
    keyPrefix: prefix,
    label,
  });

  return NextResponse.json(
    { id: keyId, key, prefix, createdAt: Date.now() },
    { status: 201 }
  );
}
