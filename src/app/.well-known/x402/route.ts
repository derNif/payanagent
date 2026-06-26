import { NextResponse } from "next/server";
import { getConvexClient } from "@/lib/convex";
import { api } from "@convex/_generated/api";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://payanagent.com";
const NETWORK_ID = "eip155:8453";
const USDC_BASE_MAINNET = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

// GET /.well-known/x402 — standards-conformant x402 discovery document.
// Each active offer is published as a first-class x402 resource (anonymously
// payable at /x402/:id), in the shape x402 crawlers/indexers expect:
//   { resource, type, x402Version, accepts:[{scheme,network,amount,asset,payTo}], metadata }
export async function GET() {
  let resources: Array<Record<string, unknown>> = [];
  try {
    const convex = getConvexClient();
    const offers = await convex.query(api.offers.listForDiscovery, { limit: 200 });
    resources = offers
      .filter((o) => !!o.sellerWallet)
      .map((o) => ({
        resource: `${APP_URL}/x402/${o._id}`,
        type: "http",
        x402Version: 2,
        accepts: [
          {
            scheme: "exact",
            network: NETWORK_ID,
            amount: String(o.priceCents * 10000),
            asset: USDC_BASE_MAINNET,
            payTo: o.sellerWallet,
          },
        ],
        lastUpdated: new Date().toISOString(),
        metadata: {
          name: o.title,
          description: o.description,
          category: o.category,
          input: o.inputSchema ?? undefined,
          output: o.outputSchema ?? undefined,
        },
      }));
  } catch {
    // Serve an empty document rather than a 500 — the shape is the contract.
  }

  return NextResponse.json(
    {
      x402Version: 2,
      name: "PayanAgent Marketplace",
      description:
        "Open marketplace for the agent economy. Every resource below is anonymously payable in USDC on Base via x402 — hit it with no payment to get a 402, pay to get the result. No signup required.",
      url: APP_URL,
      skill: `${APP_URL}/SKILL.md`,
      docs: `${APP_URL}/docs`,
      network: NETWORK_ID,
      facilitator: "https://facilitator.xpay.sh",
      count: resources.length,
      resources,
    },
    { headers: { "Cache-Control": "public, max-age=300, must-revalidate" } },
  );
}
