import { NextRequest, NextResponse } from "next/server";
import { isAdminKeyValid } from "@/lib/admin-auth";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, Payment-Signature, Payment-Required, X-Payment",
  "Access-Control-Expose-Headers": "Payment-Required, X-Transaction-Id, X-Tx-Hash, X-Receipt-Id, X-Routed-Through",
  "Access-Control-Max-Age": "86400",
};

export function proxy(request: NextRequest) {
  // Admin route protection — key checked server-side, never exposed to client
  if (request.nextUrl.pathname.startsWith("/admin")) {
    // `x-admin-key` is preferred: a key in the query string lands in access
    // logs, browser history, and the Referer of every outbound link.
    const providedKey =
      request.headers.get("x-admin-key") ?? request.nextUrl.searchParams.get("key");

    if (!isAdminKeyValid(providedKey)) {
      return new NextResponse("Unauthorized", { status: 401 });
    }
  }

  // Handle CORS preflight
  if (request.method === "OPTIONS") {
    return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
  }

  // Add CORS headers to all API responses
  if (request.nextUrl.pathname.startsWith("/api/")) {
    const response = NextResponse.next();
    for (const [key, value] of Object.entries(CORS_HEADERS)) {
      response.headers.set(key, value);
    }
    return response;
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/api/:path*", "/admin", "/admin/:path*"],
};
