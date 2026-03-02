import { NextRequest, NextResponse } from "next/server";
import { getConvexClient } from "@/lib/convex";
import { authenticateRequest, unauthorizedResponse } from "@/lib/auth";
import { api } from "@convex/_generated/api";
import { Id } from "@convex/_generated/dataModel";

// GET /api/v1/services/:serviceId — Get service detail
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ serviceId: string }> }
) {
  const agent = await authenticateRequest(request);
  if (!agent) return unauthorizedResponse();

  const { serviceId } = await params;
  const convex = getConvexClient();

  try {
    const service = await convex.query(api.services.getById, {
      serviceId: serviceId as Id<"services">,
    });

    if (!service) {
      return NextResponse.json({ error: "Service not found" }, { status: 404 });
    }

    // Also get the provider agent info
    const providerAgent = await convex.query(api.agents.getById, {
      agentId: service.agentId,
    });

    return NextResponse.json({
      ...service,
      provider: providerAgent
        ? {
            agentId: providerAgent._id,
            name: providerAgent.name,
            averageRating: providerAgent.averageRating,
            totalJobsCompleted: providerAgent.totalJobsCompleted,
          }
        : null,
    });
  } catch {
    return NextResponse.json({ error: "Invalid service ID" }, { status: 400 });
  }
}
