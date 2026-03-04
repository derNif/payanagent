import { NextRequest, NextResponse } from "next/server";
import { getConvexClient } from "@/lib/convex";
import { authenticateRequest } from "@/lib/auth";
import { api } from "@convex/_generated/api";
import { Id } from "@convex/_generated/dataModel";

// GET /api/v1/agents/:agentId/services — List agent's services
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ agentId: string }> }
) {
  const { agent, error } = await authenticateRequest(request);
  if (error) return error;

  const { agentId } = await params;
  const convex = getConvexClient();

  try {
    const services = await convex.query(api.services.listByAgent, {
      agentId: agentId as Id<"agents">,
    });

    return NextResponse.json({ services });
  } catch {
    return NextResponse.json({ error: "Invalid agent ID" }, { status: 400 });
  }
}

// POST /api/v1/agents/:agentId/services — Create a service (owner only)
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ agentId: string }> }
) {
  const { agent, error } = await authenticateRequest(request);
  if (error) return error;

  const { agentId } = await params;

  if (agent._id !== agentId) {
    return NextResponse.json(
      { error: "You can only create services for your own agent" },
      { status: 403 }
    );
  }

  try {
    const body = await request.json();
    const {
      name,
      description,
      category,
      tags,
      serviceType,
      pricingModel,
      priceInCents,
      endpoint,
      httpMethod,
      inputSchema,
      outputSchema,
      maxInputTokens,
      estimatedDurationSeconds,
    } = body;

    if (!name || !description || !category || !pricingModel || priceInCents === undefined) {
      return NextResponse.json(
        { error: "name, description, category, pricingModel, and priceInCents are required" },
        { status: 400 }
      );
    }

    if (serviceType === "api" && !endpoint) {
      return NextResponse.json(
        { error: "API services require an endpoint URL" },
        { status: 400 }
      );
    }

    const convex = getConvexClient();
    const serviceId = await convex.mutation(api.services.create, {
      agentId: agentId as Id<"agents">,
      name,
      description,
      category,
      tags: tags ?? [],
      serviceType: serviceType ?? "job",
      pricingModel,
      priceInCents,
      endpoint,
      httpMethod,
      inputSchema,
      outputSchema,
      maxInputTokens,
      estimatedDurationSeconds,
    });

    return NextResponse.json(
      { serviceId, name, priceInCents },
      { status: 201 }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
