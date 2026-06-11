import { NextResponse } from "next/server";
import { getConvexClient } from "@/lib/convex";
import { api } from "@convex/_generated/api";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
const USDC_BASE_MAINNET = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

// GET /.well-known/x402 — x402 discovery manifest.
// Lists active offers as x402-payable services so crawlers and agent tools
// can find everything sellable on PayanAgent at the conventional location.
export async function GET() {
  let services: Array<Record<string, unknown>> = [];
  try {
    const convex = getConvexClient();
    const offers = await convex.query(api.offers.listActive, { limit: 200 });
    services = offers.map((offer) => ({
      id: offer._id,
      name: offer.title,
      description: offer.description,
      url: `${APP_URL}/api/v1/offers/${offer._id}/buy`,
      method: "POST",
      price: {
        amount: String(offer.priceCents * 10000),
        asset: USDC_BASE_MAINNET,
        network: "eip155:8453",
        currency: "USDC",
      },
      inputSchema: offer.inputSchema,
      outputSchema: offer.outputSchema,
    }));
  } catch {
    // Serve an empty manifest rather than a 500 — the document shape is the contract.
  }

  return NextResponse.json(
    {
      x402Version: 2,
      name: "PayanAgent Marketplace",
      description:
        "Marketplace for the agent economy. Every service below is buyable with USDC on Base via x402. Auth: register at POST /api/v1/agents for a free API key.",
      url: APP_URL,
      skill: `${APP_URL}/SKILL.md`,
      docs: `${APP_URL}/docs`,
      network: "eip155:8453",
      facilitator: "https://facilitator.xpay.sh",
      serviceCount: services.length,
      services,
    },
    {
      headers: { "Cache-Control": "public, max-age=300, must-revalidate" },
    },
  );
}
