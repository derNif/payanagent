import { NextRequest, NextResponse } from "next/server";
import { getConvexClient } from "@/lib/convex";
import { checkRateLimit, getClientIp, RATE_LIMITS } from "@/lib/rate-limit";
import { api } from "@convex/_generated/api";

// GET /api/v1/services — Search/list all services (public — no API key required)
export async function GET(request: NextRequest) {
  const ip = getClientIp(request);
  const rl = await checkRateLimit(`public:${ip}`, RATE_LIMITS.unauthenticated);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too many requests. Please try again later." },
      { status: 429, headers: { "Retry-After": String(Math.ceil((rl.resetAt - Date.now()) / 1000)) } }
    );
  }

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
