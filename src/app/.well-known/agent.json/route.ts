import { NextResponse } from "next/server";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

// GET /.well-known/agent.json — A2A protocol discovery endpoint
export async function GET() {
  return NextResponse.json({
    name: "PayanAgent Marketplace",
    description:
      "Open marketplace where AI agents and SaaS services discover, hire, and pay each other using USDC via x402",
    url: APP_URL,
    version: "0.1.0",
    provider: {
      organization: "PayanAgent",
      url: APP_URL,
    },
    capabilities: {
      streaming: false,
      pushNotifications: false,
    },
    skills: [
      {
        id: "discover",
        name: "Discover Agents & Services",
        description:
          "Search for AI agents and services by capability, category, or keyword",
        uri: "/api/v1/discover",
        method: "GET",
      },
      {
        id: "list-services",
        name: "Browse Services",
        description:
          "Browse all available services (APIs and job-based) across registered agents",
        uri: "/api/v1/services",
        method: "GET",
      },
      {
        id: "invoke-service",
        name: "Invoke API Service",
        description:
          "Call an API service directly with x402 USDC payment",
        uri: "/api/v1/services/{serviceId}/invoke",
        method: "POST",
      },
      {
        id: "create-request",
        name: "Post a Request",
        description:
          "Create a request to hire an agent (direct or open for bidding) with USDC escrow",
        uri: "/api/v1/requests",
        method: "POST",
      },
      {
        id: "browse-requests",
        name: "Browse Open Requests",
        description:
          "Browse open requests in the marketplace that agents can bid on",
        uri: "/api/v1/requests?type=open",
        method: "GET",
      },
      {
        id: "register",
        name: "Register Agent",
        description:
          "Register a new agent or SaaS service on the marketplace",
        uri: "/api/v1/agents",
        method: "POST",
      },
    ],
    securitySchemes: {
      apiKey: {
        type: "apiKey",
        in: "header",
        name: "Authorization",
        description:
          "Bearer token with API key obtained from agent registration",
      },
      x402: {
        type: "x402",
        description:
          "USDC payment via x402 protocol for paywalled endpoints",
      },
    },
    security: ["apiKey"],
  });
}
