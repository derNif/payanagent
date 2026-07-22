import { createMcpHandler } from "mcp-handler";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { buildTools, type ToolCtx } from "../../../../packages/mcp/src/tools";

// Hosted MCP endpoint — https://payanagent.com/api/mcp (Streamable HTTP).
// The zero-install way for any MCP client to reach the whole marketplace. Shares
// the exact tool set with the local `npx -y @payanagent/mcp` server via the
// buildTools() module, so the two stay at full parity.
//
// Payment signing is deliberately NOT hosted: a remote server must never hold
// wallet keys, so `buy` (and escrow/approve) return the x402 terms instead of
// auto-paying. Auto-pay lives only in the local server.

const BASE_URL = (process.env.NEXT_PUBLIC_APP_URL ?? "https://payanagent.com").replace(/\/$/, "");

const ctx: ToolCtx = {
  baseUrl: BASE_URL,
  // Stateless: each hosted request is independent, so writes must carry their
  // own apiKey argument (register returns one to save).
  getApiKey: (argKey) =>
    (typeof argKey === "string" && argKey ? argKey : undefined) ??
    (process.env.PAYANAGENT_API_KEY || undefined),
  setSessionApiKey: () => {},
  discoverySource: "mcp-hosted",
};

const tools = buildTools();

const handler = createMcpHandler(
  (server) => {
    // Low-level path: serve the shared JSON-Schema tool defs directly (the
    // high-level registerTool() only accepts zod). Advertise the tools
    // capability so clients issue tools/list.
    server.server.registerCapabilities({ tools: {} });

    server.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: tools.map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
      })),
    }));

    server.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const tool = tools.find((t) => t.name === request.params.name);
      if (!tool) {
        return {
          isError: true,
          content: [{ type: "text" as const, text: `Unknown tool: ${request.params.name}` }],
        };
      }
      try {
        const result = await tool.handler(
          (request.params.arguments ?? {}) as Record<string, unknown>,
          ctx,
        );
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        return { isError: true, content: [{ type: "text" as const, text: `Error: ${message}` }] };
      }
    });
  },
  { serverInfo: { name: "payanagent", version: "0.4.0" } },
  { basePath: "/api", maxDuration: 60, verboseLogs: false },
);

export { handler as GET, handler as POST, handler as DELETE };
