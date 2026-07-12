import { createMcpHandler } from "mcp-handler";
import { z } from "zod";

// Hosted MCP endpoint — https://payanagent.com/api/mcp (Streamable HTTP).
// The zero-install way for any MCP client (web agents, connectors, Smithery)
// to discover and price the whole catalog. Payment signing is deliberately NOT
// hosted: a remote server must never hold wallet keys, so `buy` returns the
// offer's exact 402 terms; auto-pay lives in the local `npx -y @payanagent/mcp`.

const BASE_URL = (process.env.NEXT_PUBLIC_APP_URL ?? "https://payanagent.com").replace(/\/$/, "");

async function api<T = unknown>(path: string): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { "Content-Type": "application/json" },
  });
  const text = await res.text();
  let parsed: unknown;
  try {
    parsed = text ? JSON.parse(text) : undefined;
  } catch {
    parsed = text;
  }
  if (!res.ok) {
    const msg =
      parsed && typeof parsed === "object" && "error" in parsed
        ? String((parsed as { error: unknown }).error)
        : `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return parsed as T;
}

const asText = (data: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
});

const handler = createMcpHandler(
  (server) => {
    server.registerTool(
      "payanagent_discover",
      {
        title: "Discover services",
        description:
          "Search the PayanAgent marketplace — 24,000+ live x402 services (native offers + the whole x402 ecosystem in one catalog) plus agents and open requests — with a free-text query. Results include receipt-derived seller trust scores.",
        inputSchema: {
          query: z.string().describe("Free-text search query."),
          category: z.string().optional(),
          maxPriceCents: z.number().optional(),
          limit: z.number().optional().describe("Max results per bucket (default 50, max 200)."),
        },
      },
      async ({ query, category, maxPriceCents, limit }) => {
        const sp = new URLSearchParams({ q: query });
        if (category) sp.set("category", category);
        if (maxPriceCents !== undefined) sp.set("maxPriceCents", String(maxPriceCents));
        if (limit !== undefined) sp.set("limit", String(limit));
        return asText(await api(`/api/v1/discover?${sp}`));
      },
    );

    server.registerTool(
      "payanagent_list_offers",
      {
        title: "Browse offers",
        description: "List or filter offers for sale on PayanAgent without a free-text query.",
        inputSchema: {
          category: z.string().optional(),
          offerType: z.enum(["api", "download"]).optional(),
          limit: z.number().optional().describe("1..200 (default 50)"),
        },
      },
      async ({ category, offerType, limit }) => {
        const sp = new URLSearchParams();
        if (category) sp.set("category", category);
        if (offerType) sp.set("offerType", offerType);
        if (limit !== undefined) sp.set("limit", String(limit));
        const q = sp.toString();
        return asText(await api(q ? `/api/v1/offers?${q}` : "/api/v1/offers"));
      },
    );

    server.registerTool(
      "payanagent_get_offer",
      {
        title: "Offer details",
        description: "Get the public details of a single offer by id (price, schemas, seller reputation).",
        inputSchema: { offerId: z.string() },
      },
      async ({ offerId }) => asText(await api(`/api/v1/offers/${offerId}`)),
    );

    server.registerTool(
      "payanagent_buy",
      {
        title: "Get purchase terms",
        description:
          "Get the exact x402 payment terms for any offer (native or ecosystem — all 24k+ work the same) via the universal route POST /x402/:offerId. Anonymous: no account; the wallet is the identity. This hosted server never holds wallet keys, so it returns the cryptographic 402 terms (amount, asset, payTo) plus the buy URL — pay with any x402 client, or run `npx -y @payanagent/mcp` locally with PAYANAGENT_WALLET_PRIVATE_KEY for fully automatic purchases.",
        inputSchema: {
          offerId: z.string(),
          input: z
            .record(z.string(), z.unknown())
            .optional()
            .describe("JSON payload the service expects (shape per the offer's inputSchema)."),
        },
      },
      async ({ offerId, input }) => {
        const url = `${BASE_URL}/x402/${offerId}`;
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input ?? {}),
        });
        const text = await res.text();
        let body: unknown;
        try {
          body = text ? JSON.parse(text) : undefined;
        } catch {
          body = text;
        }
        if (res.status === 402) {
          let terms: unknown;
          for (const h of ["payment-required", "x-payment-required"]) {
            const raw = res.headers.get(h);
            if (!raw) continue;
            try {
              terms = JSON.parse(Buffer.from(raw, "base64").toString("utf8"));
              break;
            } catch {
              terms = raw;
            }
          }
          return asText({
            paymentRequired: true,
            buyUrl: url,
            terms: terms ?? body,
            how: "Sign these x402 terms with any x402 client and retry the POST — or install the local MCP (npx -y @payanagent/mcp) with PAYANAGENT_WALLET_PRIVATE_KEY to complete purchases automatically.",
          });
        }
        if (!res.ok) {
          throw new Error(
            body && typeof body === "object" && "error" in body
              ? String((body as { error: unknown }).error)
              : `HTTP ${res.status}`,
          );
        }
        return asText(body);
      },
    );

    server.registerTool(
      "payanagent_receipts_feed",
      {
        title: "Receipts feed",
        description:
          "Live public feed of settlements across the marketplace — every receipt is signed and backed by an on-chain tx.",
        inputSchema: { limit: z.number().optional().describe("1..200 (default 50).") },
      },
      async ({ limit }) =>
        asText(await api(limit !== undefined ? `/api/v1/receipts?limit=${limit}` : "/api/v1/receipts")),
    );

    server.registerTool(
      "payanagent_agent_receipts",
      {
        title: "Agent reputation",
        description:
          "An agent's receipt history and live-computed reputation (trust score, sales, distinct buyers). Use before buying.",
        inputSchema: {
          agentId: z.string(),
          side: z.enum(["buyer", "seller", "both"]).optional(),
          limit: z.number().optional(),
        },
      },
      async ({ agentId, side, limit }) => {
        const sp = new URLSearchParams();
        if (side) sp.set("side", side);
        if (limit !== undefined) sp.set("limit", String(limit));
        const q = sp.toString();
        return asText(await api(q ? `/api/v1/agents/${agentId}/receipts?${q}` : `/api/v1/agents/${agentId}/receipts`));
      },
    );
  },
  { serverInfo: { name: "payanagent", version: "0.3.1" } },
  { basePath: "/api", maxDuration: 60, verboseLogs: false },
);

export { handler as GET, handler as POST, handler as DELETE };
