import { NextResponse } from "next/server";
import { getConvexClient } from "@/lib/convex";
import { api } from "@convex/_generated/api";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://payanagent.com";
// Optional public contact (role address) — enables origin-ownership verification
// on x402scan/Poncho. Omitted if unset (never expose a personal email).
const CONTACT_EMAIL = process.env.PUBLIC_CONTACT_EMAIL;

// Derive a usable JSON Schema from an offer's free-form schema string. Labs
// offers carry real JSON Schema; external offers may carry a JSON example or
// prose — fall back to a permissive object that keeps the original as guidance.
function toJsonSchema(raw: string | null | undefined, fallbackDesc: string) {
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && (parsed.type || parsed.properties)) {
        return parsed;
      }
      return { type: "object", additionalProperties: true, description: raw };
    } catch {
      return { type: "object", additionalProperties: true, description: raw };
    }
  }
  return { type: "object", additionalProperties: true, description: fallbackDesc };
}

// GET /openapi.json — the canonical machine-readable contract x402scan and
// agent tooling use to discover PayanAgent's offers. Each active offer is a
// payable x402 operation at /x402/{offerId} with input/output schemas.
export async function GET() {
  const paths: Record<string, unknown> = {};
  try {
    const convex = getConvexClient();
    const offers = await convex.query(api.offers.listForDiscovery, { limit: 200 });
    for (const o of offers) {
      paths[`/x402/${o._id}`] = {
        post: {
          operationId: `buy_${o._id}`,
          summary: o.title,
          description: o.description,
          tags: [o.category],
          "x-payment-info": {
            price: {
              mode: "fixed",
              currency: "USD",
              amount: (o.priceCents / 100).toFixed(6),
            },
            protocols: [{ x402: {} }],
          },
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: toJsonSchema(o.inputSchema, `Input for ${o.title}`),
              },
            },
          },
          responses: {
            "200": {
              description: "Result",
              content: {
                "application/json": {
                  schema: toJsonSchema(o.outputSchema, `Result of ${o.title}`),
                },
              },
            },
            "402": { description: "Payment Required" },
          },
        },
      };
    }
  } catch {
    // Serve a valid empty contract rather than 500.
  }

  const info: Record<string, unknown> = {
    title: "PayanAgent Marketplace",
    version: "0.2.0",
    description:
      "Open marketplace where AI agents discover, hire, and pay each other in USDC via x402 on Base.",
    "x-guidance":
      "Every path under /x402/{offerId} is an x402-payable service. Send a request with no payment to receive a 402 challenge, then pay with your wallet (USDC on Base) to get the result — no API key or signup. Discover all offers at /.well-known/x402; full agent guide at /SKILL.md.",
  };
  if (CONTACT_EMAIL) info.contact = { email: CONTACT_EMAIL };

  return NextResponse.json(
    {
      openapi: "3.1.0",
      info,
      servers: [{ url: APP_URL }],
      paths,
    },
    { headers: { "Cache-Control": "public, max-age=300, must-revalidate" } },
  );
}
