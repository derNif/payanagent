import { NextRequest, NextResponse } from "next/server";
import { getConvexClient, PLATFORM_SECRET } from "@/lib/convex";
import { generateApiKey, rateLimitResponse } from "@/lib/auth";
import { checkRateLimit, getClientIp, RATE_LIMITS } from "@/lib/rate-limit";
import { validateBody, registerAgentSchema } from "@/lib/validation";
import { toPublicAgent } from "@/lib/public-projections";
import { api } from "@convex/_generated/api";

// GET /api/v1/agents — Public agent directory.
export async function GET(request: NextRequest) {
  const ip = getClientIp(request);
  const rl = await checkRateLimit(`public:${ip}`, RATE_LIMITS.unauthenticated);
  if (!rl.allowed) return rateLimitResponse(rl.resetAt);

  const statusParam = request.nextUrl.searchParams.get("status");
  const status =
    statusParam === "active" || statusParam === "suspended" || statusParam === "deactivated"
      ? statusParam
      : undefined;

  try {
    const convex = getConvexClient();
    const agents = await convex.query(api.agents.list, { status });
    return NextResponse.json({ agents: agents.map(toPublicAgent) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// POST /api/v1/agents — Register a new agent (no auth required)
export async function POST(request: NextRequest) {
  // Rate limit: 5 registrations per hour per IP
  const ip = getClientIp(request);
  const rl = await checkRateLimit(`reg:${ip}`, RATE_LIMITS.registration);
  if (!rl.allowed) return rateLimitResponse(rl.resetAt);

  try {
    const { data, error: validationError } = await validateBody(request, registerAgentSchema);
    if (validationError) return validationError;

    const { name, description, walletAddress, chain, tags, providerType, agentUrl, ownerEmail, discoverySource, a2aCapabilities } = data;

    const convex = getConvexClient();

    // Create the agent
    const agentId = await convex.mutation(api.agents.create, {
      platformSecret: PLATFORM_SECRET,
      name,
      description,
      walletAddress,
      chain: chain ?? "base",
      tags: tags ?? [],
      providerType: providerType ?? "agent",
      agentUrl,
      ownerEmail,
      discoverySource,
      a2aCapabilities,
    });

    // Generate and store API key
    const { key, hash, prefix } = generateApiKey();
    await convex.mutation(api.apiKeys.create, {
      platformSecret: PLATFORM_SECRET,
      agentId,
      keyHash: hash,
      keyPrefix: prefix,
      label: "default",
    });

    return NextResponse.json(
      {
        agentId,
        apiKey: key,
        apiKeyPrefix: prefix,
        message: "Store your API key securely. It cannot be retrieved again.",
      },
      { status: 201 }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
