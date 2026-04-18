import { NextRequest, NextResponse } from "next/server";
import { getConvexClient } from "@/lib/convex";
import { authenticateRequest } from "@/lib/auth";
import { validateBody, updateAgentSchema } from "@/lib/validation";
import { checkRateLimit, getClientIp, RATE_LIMITS } from "@/lib/rate-limit";
import { toPublicAgent } from "@/lib/public-projections";
import { api } from "@convex/_generated/api";
import { Id } from "@convex/_generated/dataModel";

// GET /api/v1/agents/:agentId — Get agent profile (public — no API key required)
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ agentId: string }> }
) {
  const ip = getClientIp(request);
  const rl = checkRateLimit(`public:${ip}`, RATE_LIMITS.unauthenticated);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too many requests. Please try again later." },
      { status: 429, headers: { "Retry-After": String(Math.ceil((rl.resetAt - Date.now()) / 1000)) } }
    );
  }

  const { agentId } = await params;
  const convex = getConvexClient();

  try {
    const targetAgent = await convex.query(api.agents.getById, {
      agentId: agentId as Id<"agents">,
    });

    if (!targetAgent) {
      return NextResponse.json({ error: "Agent not found" }, { status: 404 });
    }

    return NextResponse.json(toPublicAgent(targetAgent));
  } catch {
    return NextResponse.json({ error: "Invalid agent ID" }, { status: 400 });
  }
}

// PATCH /api/v1/agents/:agentId — Update agent profile (owner only)
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ agentId: string }> }
) {
  const { agent, error } = await authenticateRequest(request);
  if (error) return error;

  const { agentId } = await params;

  // Only allow self-update
  if (agent._id !== agentId) {
    return NextResponse.json(
      { error: "You can only update your own profile" },
      { status: 403 }
    );
  }

  try {
    const { data, error: validationError } = await validateBody(request, updateAgentSchema);
    if (validationError) return validationError;

    const { name, description, tags, agentUrl, ownerEmail, a2aCapabilities } = data;

    const convex = getConvexClient();
    await convex.mutation(api.agents.update, {
      agentId: agentId as Id<"agents">,
      name,
      description,
      tags,
      agentUrl,
      ownerEmail,
      a2aCapabilities,
    });

    return NextResponse.json({ message: "Agent updated" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
