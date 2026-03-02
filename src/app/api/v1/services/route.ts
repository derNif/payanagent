import { NextRequest, NextResponse } from "next/server";
import { getConvexClient } from "@/lib/convex";
import { authenticateRequest, unauthorizedResponse } from "@/lib/auth";
import { api } from "@convex/_generated/api";

// GET /api/v1/services — Search/list all services
export async function GET(request: NextRequest) {
  const agent = await authenticateRequest(request);
  if (!agent) return unauthorizedResponse();

  const convex = getConvexClient();
  const searchParams = request.nextUrl.searchParams;

  const query = searchParams.get("q");
  const category = searchParams.get("category");
  const serviceType = searchParams.get("type") as "api" | "job" | null;

  try {
    if (query) {
      const services = await convex.query(api.search.searchServices, {
        query,
        category: category ?? undefined,
        serviceType: serviceType ?? undefined,
      });
      return NextResponse.json({ services });
    }

    if (serviceType) {
      const services = await convex.query(api.services.listActive, {
        serviceType,
      });
      return NextResponse.json({ services });
    }

    if (category) {
      const services = await convex.query(api.services.listByCategory, {
        category,
      });
      return NextResponse.json({ services });
    }

    const services = await convex.query(api.services.listActive, {});
    return NextResponse.json({ services });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
