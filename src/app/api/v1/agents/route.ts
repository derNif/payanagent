import { NextRequest, NextResponse } from "next/server";
import { getConvexClient } from "@/lib/convex";
import { generateApiKey, rateLimitResponse } from "@/lib/auth";
import { checkRateLimit, getClientIp, RATE_LIMITS } from "@/lib/rate-limit";
import { validateBody, registerAgentSchema } from "@/lib/validation";
import { api } from "@convex/_generated/api";

// POST /api/v1/agents — Register a new agent (no auth required)
export async function POST(request: NextRequest) {
  // Rate limit: 5 registrations per hour per IP
  const ip = getClientIp(request);
  const rl = await checkRateLimit(`reg:${ip}`, RATE_LIMITS.registration);
  if (!rl.allowed) return rateLimitResponse(rl.resetAt);

  try {
    const { data, error: validationError } = await validateBody(request, registerAgentSchema);
    if (validationError) return validationError;

    const { name, description, walletAddress, chain, tags, providerType, agentUrl, ownerEmail, a2aCapabilities } = data;

    const convex = getConvexClient();

    // Create the agent
    const agentId = await convex.mutation(api.agents.create, {
      name,
      description,
      walletAddress,
      chain: chain ?? "base",
      tags: tags ?? [],
      providerType: providerType ?? "agent",
      agentUrl,
      ownerEmail,
      a2aCapabilities,
    });

    // Generate and store API key
    const { key, hash, prefix } = generateApiKey();
    await convex.mutation(api.apiKeys.create, {
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
