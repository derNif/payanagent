#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

// @payanagent/mcp — Model Context Protocol server for PayanAgent.
// Exposes the marketplace as a tool shelf for any MCP client (Claude Code,
// Cursor, ChatGPT desktop, …). No SDK dependency; speaks the v0.2 HTTP API
// directly. Authentication via PAYANAGENT_API_KEY env var.

const BASE_URL = (process.env.PAYANAGENT_BASE_URL ?? "https://payanagent.com").replace(/\/$/, "");
const API_KEY = process.env.PAYANAGENT_API_KEY ?? "";
// Optional wallet for completing x402 purchases (buys are anonymous — the
// wallet is the identity; no API key needed to buy).
const WALLET_KEY = process.env.PAYANAGENT_WALLET_PRIVATE_KEY ?? "";

// Lazily-built x402-paying fetch (only when a wallet key is configured).
let paidFetch: typeof fetch | null = null;
async function getPaidFetch(): Promise<typeof fetch | null> {
  if (!WALLET_KEY) return null;
  if (paidFetch) return paidFetch;
  const [{ x402Client, wrapFetchWithPayment }, { registerExactEvmScheme }, { privateKeyToAccount }] =
    await Promise.all([
      import("@x402/fetch"),
      import("@x402/evm/exact/client"),
      import("viem/accounts"),
    ]);
  const signer = privateKeyToAccount(WALLET_KEY as `0x${string}`);
  const client = new x402Client();
  registerExactEvmScheme(client, { signer });
  paidFetch = wrapFetchWithPayment(fetch, client) as typeof fetch;
  return paidFetch;
}

type Json = Record<string, unknown> | unknown[] | string | number | boolean | null;

function authHeaders(): Record<string, string> {
  return API_KEY ? { Authorization: `Bearer ${API_KEY}` } : {};
}

async function http<T = unknown>(
  method: string,
  path: string,
  body?: Json,
): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let parsed: unknown = undefined;
  try {
    parsed = text ? JSON.parse(text) : undefined;
  } catch {
    parsed = text;
  }
  if (!res.ok) {
    const msg =
      parsed && typeof parsed === "object" && "error" in parsed && typeof (parsed as { error?: unknown }).error === "string"
        ? (parsed as { error: string }).error
        : `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return parsed as T;
}

// --- tool definitions ---

const TOOLS = [
  {
    name: "payanagent_discover",
    description:
      "Search the PayanAgent marketplace for agents, offers (paid services + downloadable products), and open requests matching a free-text query.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Free-text search query." },
        category: { type: "string", description: "Optional offer category filter." },
        maxPriceCents: {
          type: "number",
          description: "Optional maximum offer price (cents). Filters offers only.",
        },
        offerType: {
          type: "string",
          enum: ["api", "download"],
          description: "Restrict offers to API (pay-per-call) or downloadable.",
        },
        limit: { type: "number", description: "Max results per category (default 50, max 200)." },
      },
      required: ["query"],
    },
  },
  {
    name: "payanagent_list_offers",
    description:
      "List or filter offers on PayanAgent. Use this to browse what's for sale without a free-text query.",
    inputSchema: {
      type: "object",
      properties: {
        category: { type: "string" },
        offerType: { type: "string", enum: ["api", "download"] },
        limit: { type: "number", description: "1..200 (default 50)" },
      },
    },
  },
  {
    name: "payanagent_get_offer",
    description: "Get the public details of a single offer by id.",
    inputSchema: {
      type: "object",
      properties: {
        offerId: { type: "string", description: "The offer _id (e.g. k974qgez…)." },
      },
      required: ["offerId"],
    },
  },
  {
    name: "payanagent_buy",
    description:
      "Buy any offer on PayanAgent (native or ecosystem — all 24k+ work the same) via the universal x402 route POST /x402/:offerId. Anonymous: no account or API key needed; the wallet is the identity. If the server is configured with PAYANAGENT_WALLET_PRIVATE_KEY, the purchase is completed automatically (USDC on Base, gasless) and the result + receipt id are returned. Without a wallet, the tool returns the offer's 402 payment terms and instructions so your operator can pay another way.",
    inputSchema: {
      type: "object",
      properties: {
        offerId: { type: "string" },
        input: {
          description: "JSON payload sent to the service (shape per the offer's inputSchema).",
        },
      },
      required: ["offerId"],
    },
  },
  {
    name: "payanagent_create_offer",
    description:
      "Register a new offer on PayanAgent. Sellers describe what they sell, set a price in cents, and either provide an endpoint (api) or a fileUrl (download).",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string" },
        description: { type: "string" },
        category: { type: "string" },
        tags: { type: "array", items: { type: "string" } },
        priceCents: { type: "number", description: "Integer cents (100 = $1.00)." },
        offerType: { type: "string", enum: ["api", "download"] },
        endpoint: { type: "string", description: "Required for api-type. HTTPS URL." },
        httpMethod: { type: "string", enum: ["GET", "POST", "PUT", "PATCH", "DELETE"] },
        fileUrl: { type: "string", description: "Required for download-type. Private URL." },
        inputSchema: {
          type: "string",
          description:
            "Strongly recommended. Free-form description of the request body your endpoint expects — an example JSON body, a JSON Schema, or one prose sentence. Buyer agents read this before paying.",
        },
        outputSchema: {
          type: "string",
          description: "Free-form description of what your endpoint returns.",
        },
      },
      required: ["title", "description", "category", "priceCents", "offerType"],
    },
  },
  {
    name: "payanagent_create_request",
    description:
      "Post a bespoke work request on PayanAgent. Providers can bid on it. Set escrow=true to fund the budget up-front via x402 (your client needs to sign the payment header).",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string" },
        description: { type: "string" },
        budgetMaxCents: { type: "number" },
        escrow: { type: "boolean" },
        inputPayload: { type: "string" },
        providerId: { type: "string", description: "Direct hire: provider agent id." },
        agreedPriceCents: { type: "number", description: "Required when providerId is set." },
      },
      required: ["title", "description", "budgetMaxCents"],
    },
  },
  {
    name: "payanagent_fulfill_request",
    description: "Provider delivers the output for an accepted request.",
    inputSchema: {
      type: "object",
      properties: {
        requestId: { type: "string" },
        output: { type: "string", description: "Deliverable payload as a string." },
      },
      required: ["requestId", "output"],
    },
  },
  {
    name: "payanagent_receipts_feed",
    description:
      "Get the live public receipts feed for the PayanAgent marketplace — see what's settled recently across all agents.",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number", description: "1..200 (default 50)." },
      },
    },
  },
  {
    name: "payanagent_agent_receipts",
    description:
      "Get an agent's receipt history (their reputation, computed live). Use for evaluating providers before buying.",
    inputSchema: {
      type: "object",
      properties: {
        agentId: { type: "string" },
        side: {
          type: "string",
          enum: ["buyer", "seller", "both"],
          description: "Filter to receipts where the agent was on a specific side.",
        },
        limit: { type: "number" },
      },
      required: ["agentId"],
    },
  },
];

// --- dispatch ---

interface ToolArgs {
  [k: string]: unknown;
}

async function dispatch(name: string, args: ToolArgs): Promise<Json> {
  switch (name) {
    case "payanagent_discover": {
      const sp = new URLSearchParams({ q: String(args.query) });
      if (args.category) sp.set("category", String(args.category));
      if (args.maxPriceCents !== undefined)
        sp.set("maxPriceCents", String(args.maxPriceCents));
      if (args.offerType) sp.set("offerType", String(args.offerType));
      if (args.limit !== undefined) sp.set("limit", String(args.limit));
      return (await http("GET", `/api/v1/discover?${sp.toString()}`)) as Json;
    }
    case "payanagent_list_offers": {
      const sp = new URLSearchParams();
      if (args.category) sp.set("category", String(args.category));
      if (args.offerType) sp.set("offerType", String(args.offerType));
      if (args.limit !== undefined) sp.set("limit", String(args.limit));
      const q = sp.toString();
      const path = q ? `/api/v1/offers?${q}` : "/api/v1/offers";
      return (await http("GET", path)) as Json;
    }
    case "payanagent_get_offer": {
      return (await http("GET", `/api/v1/offers/${args.offerId}`)) as Json;
    }
    case "payanagent_buy": {
      // Universal buy: /x402/:id serves every offer (native + ecosystem).
      const url = `${BASE_URL}/x402/${args.offerId}`;
      const body = JSON.stringify(args.input ?? {});
      const f = await getPaidFetch();
      const res = await (f ?? fetch)(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      });
      const text = await res.text();
      let parsed: unknown;
      try {
        parsed = text ? JSON.parse(text) : undefined;
      } catch {
        parsed = text;
      }
      if (res.status === 402) {
        // No wallet configured (or payment failed) — surface the terms.
        return {
          paymentRequired: true,
          how: f
            ? "The configured wallet's payment was not accepted — check its Base USDC balance."
            : "Set PAYANAGENT_WALLET_PRIVATE_KEY on this MCP server (a Base wallet holding USDC) to complete purchases automatically, or pay this 402 challenge with any x402 client.",
          buyUrl: url,
          challenge: parsed,
        } as Json;
      }
      if (!res.ok) {
        throw new Error(
          parsed && typeof parsed === "object" && "error" in parsed
            ? String((parsed as { error: unknown }).error)
            : `HTTP ${res.status}`,
        );
      }
      return {
        output: parsed,
        receiptId: res.headers.get("X-Receipt-Id") ?? undefined,
        txHash: res.headers.get("X-Tx-Hash") ?? undefined,
      } as Json;
    }
    case "payanagent_create_offer": {
      const body: Json = {
        title: args.title,
        description: args.description,
        category: args.category,
        tags: args.tags ?? [],
        priceCents: args.priceCents,
        offerType: args.offerType,
        endpoint: args.endpoint,
        httpMethod: args.httpMethod,
        fileUrl: args.fileUrl,
        inputSchema: args.inputSchema,
        outputSchema: args.outputSchema,
      } as Json;
      return (await http("POST", "/api/v1/offers", body)) as Json;
    }
    case "payanagent_create_request": {
      const body: Json = {
        title: args.title,
        description: args.description,
        budgetMaxCents: args.budgetMaxCents,
        escrow: args.escrow ?? false,
        inputPayload: args.inputPayload,
        providerId: args.providerId,
        agreedPriceCents: args.agreedPriceCents,
      } as Json;
      return (await http("POST", "/api/v1/requests", body)) as Json;
    }
    case "payanagent_fulfill_request": {
      return (await http("POST", `/api/v1/requests/${args.requestId}/fulfill`, {
        outputPayload: args.output,
      })) as Json;
    }
    case "payanagent_receipts_feed": {
      const limit = args.limit !== undefined ? `?limit=${args.limit}` : "";
      return (await http("GET", `/api/v1/receipts${limit}`)) as Json;
    }
    case "payanagent_agent_receipts": {
      const sp = new URLSearchParams();
      if (args.side) sp.set("side", String(args.side));
      if (args.limit !== undefined) sp.set("limit", String(args.limit));
      const q = sp.toString();
      const path = q
        ? `/api/v1/agents/${args.agentId}/receipts?${q}`
        : `/api/v1/agents/${args.agentId}/receipts`;
      return (await http("GET", path)) as Json;
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// --- server bootstrap ---

async function main(): Promise<void> {
  const server = new Server(
    { name: "payanagent", version: "0.2.0" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    try {
      const result = await dispatch(name, (args ?? {}) as ToolArgs);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return {
        isError: true,
        content: [{ type: "text", text: `Error: ${message}` }],
      };
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error("payanagent-mcp fatal:", e);
  process.exit(1);
});
