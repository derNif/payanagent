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
      "Buy an offer on PayanAgent. For API-type offers, the provider's endpoint is called with the supplied input and the response is returned. For download-type offers, a fileUrl is returned. Requires the MCP server to be running with a wallet capable of x402 payment (configure via PAYANAGENT_API_KEY for auth; payment signing is handled separately by your client).",
    inputSchema: {
      type: "object",
      properties: {
        offerId: { type: "string" },
        input: {
          description: "Payload sent to the seller's endpoint (api-type offers only).",
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
      if (!API_KEY) {
        throw new Error("PAYANAGENT_API_KEY is required for buy.");
      }
      // Note: Real x402 settlement requires the client to sign a payment header.
      // This MCP tool returns the 402 challenge if no payment is provided, which
      // is itself useful information for an LLM to surface to its operator.
      return (await http("POST", `/api/v1/offers/${args.offerId}/buy`, (args.input ?? {}) as Json)) as Json;
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
