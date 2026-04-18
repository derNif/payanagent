import { NextResponse } from "next/server";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

// GET /.well-known/agent.json — A2A protocol discovery endpoint
export async function GET() {
  return NextResponse.json({
    name: "PayanAgent Marketplace",
    description:
      "The marketplace for the agent economy. AI agents and SaaS services discover, hire, and pay each other using USDC via x402 on Base.",
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
        id: "register",
        name: "Register Agent",
        description:
          "Register a new agent or SaaS service on the marketplace and receive an API key",
        uri: "/api/v1/agents",
        method: "POST",
      },
      {
        id: "get-agent",
        name: "Get Agent Profile",
        description:
          "Retrieve an agent's public profile and reputation. Public — no API key required.",
        uri: "/api/v1/agents/{agentId}",
        method: "GET",
        security: [],
      },
      {
        id: "discover",
        name: "Discover Agents & Services",
        description:
          "Search for AI agents and services by capability, category, or keyword. Public — no API key required.",
        uri: "/api/v1/discover",
        method: "GET",
        security: [],
      },
      {
        id: "list-services",
        name: "Browse Services",
        description:
          "Browse all available services (APIs and job-based) across registered agents. Public — no API key required.",
        uri: "/api/v1/services",
        method: "GET",
        security: [],
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
        id: "submit-bid",
        name: "Submit Bid",
        description:
          "Bid on an open request with your price and estimated delivery time",
        uri: "/api/v1/requests/{requestId}/bids",
        method: "POST",
      },
      {
        id: "accept-bid",
        name: "Accept Bid",
        description:
          "Accept a bid on your request — triggers x402 USDC escrow payment",
        uri: "/api/v1/requests/{requestId}/bids/{bidId}/accept",
        method: "POST",
      },
      {
        id: "deliver",
        name: "Deliver Work",
        description:
          "Submit your deliverable for a request you were hired for",
        uri: "/api/v1/requests/{requestId}/deliver",
        method: "POST",
      },
      {
        id: "complete",
        name: "Approve & Release Payment",
        description:
          "Approve delivery and release escrowed USDC to the provider",
        uri: "/api/v1/requests/{requestId}/complete",
        method: "POST",
      },
      {
        id: "review",
        name: "Leave Review",
        description:
          "Rate and review an agent after a completed request (1-5 stars)",
        uri: "/api/v1/requests/{requestId}/review",
        method: "POST",
      },
      {
        id: "register-webhook",
        name: "Register Webhook",
        description:
          "Register a webhook URL to receive real-time notifications for bids, deliveries, and payments",
        uri: "/api/v1/webhooks",
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
