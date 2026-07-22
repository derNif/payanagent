#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { buildTools, type ToolCtx } from "./tools.js";

// @payanagent/mcp — Model Context Protocol server for PayanAgent.
// Exposes the whole marketplace as a tool shelf for any MCP client. A thin
// wrapper: every tool wraps @payanagent/sdk (see ./tools.ts), so this server
// and the hosted route stay at full parity by construction.
//
// Env: PAYANAGENT_API_KEY (optional — only to sell/manage; register mints one),
//      PAYANAGENT_WALLET_PRIVATE_KEY (optional — a Base wallet for auto-buy),
//      PAYANAGENT_BASE_URL (optional — defaults to https://payanagent.com).

const BASE_URL = (process.env.PAYANAGENT_BASE_URL ?? "https://payanagent.com").replace(/\/$/, "");
const ENV_API_KEY = process.env.PAYANAGENT_API_KEY ?? "";
const WALLET_KEY = process.env.PAYANAGENT_WALLET_PRIVATE_KEY ?? "";

// A key registered during the session supersedes the env key for the rest of it.
let sessionApiKey: string | undefined;

// Build the x402-paying fetch once, only when a wallet key is configured.
async function loadPaidFetch(): Promise<typeof fetch | undefined> {
  if (!WALLET_KEY) return undefined;
  const [{ x402Client, wrapFetchWithPayment }, { registerExactEvmScheme }, { privateKeyToAccount }] =
    await Promise.all([
      import("@x402/fetch"),
      import("@x402/evm/exact/client"),
      import("viem/accounts"),
    ]);
  const signer = privateKeyToAccount(WALLET_KEY as `0x${string}`);
  const client = new x402Client();
  registerExactEvmScheme(client, { signer });
  return wrapFetchWithPayment(fetch, client) as typeof fetch;
}

async function main(): Promise<void> {
  const paidFetch = await loadPaidFetch();

  const ctx: ToolCtx = {
    baseUrl: BASE_URL,
    getApiKey: (argKey) =>
      (typeof argKey === "string" && argKey ? argKey : undefined) ??
      sessionApiKey ??
      (ENV_API_KEY || undefined),
    setSessionApiKey: (k) => {
      sessionApiKey = k;
    },
    paidFetch,
    discoverySource: "mcp",
  };

  const tools = buildTools();

  const server = new Server(
    { name: "payanagent", version: "0.4.0" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: tools.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const tool = tools.find((t) => t.name === request.params.name);
    if (!tool) {
      return { isError: true, content: [{ type: "text", text: `Unknown tool: ${request.params.name}` }] };
    }
    try {
      const result = await tool.handler((request.params.arguments ?? {}) as Record<string, unknown>, ctx);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return { isError: true, content: [{ type: "text", text: `Error: ${message}` }] };
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((e) => {
  console.error("payanagent-mcp fatal:", e);
  process.exit(1);
});
