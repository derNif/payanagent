// Shared tool definitions for both PayanAgent MCP surfaces — the local stdio
// server (src/index.ts) and the hosted Streamable-HTTP route
// (src/app/api/[transport]/route.ts). Both wrap the SAME @payanagent/sdk, so
// the two surfaces stay at full parity by construction: every SDK capability is
// reachable from MCP, and there is exactly one place to add the next one.
//
// Tools are plain JSON Schema + a handler (no zod), so a single ToolDef can feed
// a low-level MCP Server on either transport.
import {
  PayanAgent,
  type UpdateOfferInput,
  type UpdateAgentInput,
  type SubmitBidInput,
  type CreateOfferInput,
  type CreateRequestInput,
  type RegisterAgentInput,
} from "@payanagent/sdk";

export interface ToolCtx {
  baseUrl: string;
  /** Resolve the API key for a call: explicit tool arg > session key > env. */
  getApiKey(argKey?: unknown): string | undefined;
  /** Remember a key for the rest of a session (stdio). No-op on hosted (stateless). */
  setSessionApiKey(key: string): void;
  /** x402-signing fetch — present only on the local stdio server (never hosted). */
  paidFetch?: typeof fetch;
  /** Default discoverySource stamped on register: "mcp" (stdio) | "mcp-hosted". */
  discoverySource: string;
}

export interface ToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler(args: Record<string, unknown>, ctx: ToolCtx): Promise<unknown>;
}

function sdkFor(ctx: ToolCtx, argKey?: unknown): PayanAgent {
  return new PayanAgent({
    apiKey: ctx.getApiKey(argKey),
    baseUrl: ctx.baseUrl,
    fetchWithPayment: ctx.paidFetch,
  });
}

const str = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);
const num = (v: unknown): number | undefined => (v === undefined || v === null ? undefined : Number(v));

// x402 v2 carries the payment terms base64-JSON-encoded in a response header,
// not the body. Decode whichever header the facilitator used.
function decodeTerms(res: Response): unknown {
  for (const h of ["payment-required", "x-payment-required"]) {
    const raw = res.headers.get(h);
    if (!raw) continue;
    try {
      return JSON.parse(Buffer.from(raw, "base64").toString("utf8"));
    } catch {
      return raw;
    }
  }
  return undefined;
}

// buy is the one handler that doesn't route through sdk.buy(): the SDK throws
// without a wallet, but the hosted server has no wallet by design and should
// return the 402 terms instead of erroring. One implementation serves both:
// auto-pay when paidFetch is present, otherwise surface the challenge.
async function buyHandler(args: Record<string, unknown>, ctx: ToolCtx): Promise<unknown> {
  const url = `${ctx.baseUrl}/x402/${args.offerId}`;
  const f = ctx.paidFetch ?? fetch;
  const res = await f(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(args.input ?? {}),
  });
  const text = await res.text();
  let parsed: unknown;
  try {
    parsed = text ? JSON.parse(text) : undefined;
  } catch {
    parsed = text;
  }
  if (res.status === 402) {
    return {
      paymentRequired: true,
      buyUrl: url,
      terms: decodeTerms(res) ?? parsed,
      how: ctx.paidFetch
        ? "The configured wallet's payment was not accepted — check its Base USDC balance."
        : "This server holds no wallet. Sign these x402 terms with any x402 client and retry the POST, or run `npx -y @payanagent/mcp` locally with PAYANAGENT_WALLET_PRIVATE_KEY to complete purchases automatically.",
    };
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
  };
}

// Reused schema fragment: every write tool accepts an optional apiKey so the
// stateless hosted server can authenticate per-call (the local server prefers
// PAYANAGENT_API_KEY and this can be omitted there).
const apiKeyProp = {
  apiKey: {
    type: "string",
    description:
      "API key for authenticated actions. On the local server, prefer setting PAYANAGENT_API_KEY instead. Register first with payanagent_agent{action:'register'} if you don't have one.",
  },
};

// The ToolDefs are static; the live ToolCtx flows to each handler per-call from
// the server dispatcher, so build takes no argument.
export function buildTools(): ToolDef[] {
  return [
    {
      name: "payanagent_discover",
      description:
        "Search the PayanAgent marketplace — 24,000+ live x402 services (native offers + the whole x402 ecosystem in one catalog) plus agents and open requests — with a free-text query. Results include receipt-derived seller trust scores.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Free-text search query." },
          category: { type: "string", description: "Optional offer category filter." },
          maxPriceCents: { type: "number", description: "Optional max offer price (cents)." },
          offerType: { type: "string", enum: ["api", "download"] },
          limit: { type: "number", description: "Max results per bucket (default 50, max 200)." },
        },
        required: ["query"],
      },
      handler: (a, c) =>
        sdkFor(c).discover(String(a.query), {
          category: str(a.category),
          maxPriceCents: num(a.maxPriceCents),
          offerType: str(a.offerType) as "api" | "download" | undefined,
          limit: num(a.limit),
        }),
    },
    {
      name: "payanagent_list_offers",
      description:
        "Browse or page through offers without a free-text query. Supports keyword `q`, ranked `sort` (top | price | new), and `cursor` pagination — pass back the returned `nextCursor` to walk the whole catalog.",
      inputSchema: {
        type: "object",
        properties: {
          q: { type: "string", description: "Optional keyword filter." },
          category: { type: "string" },
          offerType: { type: "string", enum: ["api", "download"] },
          sort: { type: "string", enum: ["top", "price", "new"], description: "Ranked order (default top)." },
          cursor: { type: "string", description: "Pagination cursor from a previous nextCursor." },
          limit: { type: "number", description: "1..200 (default 50)." },
        },
      },
      handler: (a, c) =>
        sdkFor(c).offers.listPage({
          q: str(a.q),
          category: str(a.category),
          offerType: str(a.offerType) as "api" | "download" | undefined,
          sort: str(a.sort) as "top" | "price" | "new" | undefined,
          cursor: str(a.cursor),
          limit: num(a.limit),
        }),
    },
    {
      name: "payanagent_get_offer",
      description: "Get the public details of a single offer by id (price, schemas, seller reputation).",
      inputSchema: {
        type: "object",
        properties: { offerId: { type: "string" } },
        required: ["offerId"],
      },
      handler: (a, c) => sdkFor(c).offers.get(String(a.offerId)),
    },
    {
      name: "payanagent_buy",
      description:
        "Buy any offer (native or ecosystem — all 24k+ work the same) via the universal x402 route POST /x402/:offerId. Anonymous: no account or API key; the wallet is the identity. If this server holds a wallet (PAYANAGENT_WALLET_PRIVATE_KEY, local only), the purchase completes automatically (USDC on Base) and the result + receipt id are returned. Otherwise it returns the exact 402 payment terms to pay with any x402 client.",
      inputSchema: {
        type: "object",
        properties: {
          offerId: { type: "string" },
          input: { description: "JSON payload the service expects (shape per the offer's inputSchema)." },
        },
        required: ["offerId"],
      },
      handler: buyHandler,
    },
    {
      name: "payanagent_create_offer",
      description:
        "List a new offer for sale (requires an API key). Set a price in cents and either an endpoint (api-type) or a fileUrl (download-type). If your API is ALREADY x402-gated, pass externalUrl instead of endpoint — PayanAgent verifies your 402 terms (payTo must be this agent's wallet) and relays buyers to it non-custodially.",
      inputSchema: {
        type: "object",
        properties: {
          ...apiKeyProp,
          title: { type: "string" },
          description: { type: "string" },
          category: { type: "string" },
          tags: { type: "array", items: { type: "string" } },
          priceCents: {
            type: "number",
            description: "Integer cents (100 = $1.00). Omit for externalUrl relay offers — price comes from your own 402 terms.",
          },
          offerType: { type: "string", enum: ["api", "download"] },
          endpoint: { type: "string", description: "api-type, native mode: HTTPS URL PayanAgent proxies after settling. Mutually exclusive with externalUrl." },
          externalUrl: {
            type: "string",
            description: "api-type, relay mode: an HTTPS URL that already answers with its own x402 402 challenge. Its payTo must equal this agent's walletAddress.",
          },
          httpMethod: { type: "string", enum: ["GET", "POST", "PUT", "PATCH", "DELETE"] },
          verificationBody: {
            type: "object",
            description:
              "Relay registration only: schema-valid JSON sent once during the unpaid 402 ownership probe when the external gate validates input before returning 402. Not stored or used for buys.",
            additionalProperties: true,
          },
          fileUrl: { type: "string", description: "Required for download-type. Private URL." },
          inputSchema: {
            type: "string",
            description:
              "Strongly recommended. Free-form description of the request body your endpoint expects — an example JSON body, a JSON Schema, or one prose sentence.",
          },
          outputSchema: { type: "string", description: "Free-form description of what your endpoint returns." },
        },
        required: ["title", "description", "category", "offerType"],
      },
      handler: (a, c) =>
        sdkFor(c, a.apiKey).offer({
          title: String(a.title),
          description: String(a.description),
          category: String(a.category),
          tags: (a.tags as string[] | undefined) ?? [],
          priceCents: a.priceCents === undefined ? undefined : Number(a.priceCents),
          offerType: a.offerType as CreateOfferInput["offerType"],
          endpoint: str(a.endpoint),
          externalUrl: str(a.externalUrl),
          httpMethod: str(a.httpMethod),
          verificationBody: a.verificationBody as Record<string, unknown> | undefined,
          fileUrl: str(a.fileUrl),
          inputSchema: str(a.inputSchema),
          outputSchema: str(a.outputSchema),
        }),
    },
    {
      name: "payanagent_manage_offer",
      description:
        "Update or deactivate one of your existing offers (requires an API key; seller only). action='update' patches fields; action='deactivate' takes it off the market.",
      inputSchema: {
        type: "object",
        properties: {
          ...apiKeyProp,
          action: { type: "string", enum: ["update", "deactivate"] },
          offerId: { type: "string" },
          patch: {
            type: "object",
            description: "For action='update': the fields to change (title, description, priceCents, endpoint, isActive, …).",
          },
        },
        required: ["action", "offerId"],
      },
      handler: (a, c) => {
        const pa = sdkFor(c, a.apiKey);
        if (a.action === "deactivate") return pa.offers.deactivate(String(a.offerId));
        if (a.action === "update") return pa.offers.update(String(a.offerId), (a.patch ?? {}) as UpdateOfferInput);
        throw new Error("action must be 'update' or 'deactivate'");
      },
    },
    {
      name: "payanagent_agent",
      description:
        "Manage agent identities. action='register' creates a new agent + returns a fresh API key (no key needed to call this — it mints one; save it, it is shown only once). action='get' fetches a public profile + reputation. action='update' edits your own profile (requires your API key).",
      inputSchema: {
        type: "object",
        properties: {
          ...apiKeyProp,
          action: { type: "string", enum: ["register", "get", "update"] },
          agentId: { type: "string", description: "For action='get' or 'update'." },
          agent: {
            type: "object",
            description:
              "For action='register': { name, description, walletAddress, chain?, tags?, providerType?, agentUrl?, ownerEmail? }. walletAddress is your Base address — your identity for buying and being paid.",
          },
          patch: {
            type: "object",
            description: "For action='update': the profile fields to change (name, description, tags, agentUrl, …).",
          },
        },
        required: ["action"],
      },
      handler: async (a, c) => {
        const pa = sdkFor(c, a.apiKey);
        if (a.action === "register") {
          const input = (a.agent ?? {}) as RegisterAgentInput;
          const res = await pa.agents.register({
            ...input,
            discoverySource: input.discoverySource ?? c.discoverySource,
          });
          c.setSessionApiKey(res.apiKey);
          return {
            ...res,
            _note:
              "SAVE THIS apiKey now — it is shown only once and cannot be retrieved again. To persist it, set PAYANAGENT_API_KEY in your MCP server config. On the local server it is now used automatically for the rest of this session; on the hosted server, pass it as the apiKey argument to authenticated tools.",
          };
        }
        if (a.action === "get") return pa.agents.get(String(a.agentId));
        if (a.action === "update") return pa.agents.update(String(a.agentId), (a.patch ?? {}) as UpdateAgentInput);
        throw new Error("action must be 'register', 'get', or 'update'");
      },
    },
    {
      name: "payanagent_create_request",
      description:
        "Post a bespoke work request that providers can bid on (requires an API key). Set escrow=true to fund the budget up-front via x402 — that needs a wallet, so it only works on the local server with PAYANAGENT_WALLET_PRIVATE_KEY.",
      inputSchema: {
        type: "object",
        properties: {
          ...apiKeyProp,
          title: { type: "string" },
          description: { type: "string" },
          budgetMaxCents: { type: "number" },
          escrow: { type: "boolean", description: "Fund the budget in escrow now (needs a wallet)." },
          inputPayload: { type: "string" },
          providerId: { type: "string", description: "Direct hire: assign a provider immediately." },
          agreedPriceCents: { type: "number", description: "Required when providerId is set." },
        },
        required: ["title", "description", "budgetMaxCents"],
      },
      handler: (a, c) =>
        sdkFor(c, a.apiKey).request({
          title: String(a.title),
          description: String(a.description),
          budgetMaxCents: Number(a.budgetMaxCents),
          escrow: Boolean(a.escrow),
          inputPayload: str(a.inputPayload),
          providerId: str(a.providerId),
          agreedPriceCents: num(a.agreedPriceCents),
        } as CreateRequestInput),
    },
    {
      name: "payanagent_requests",
      description:
        "The request lifecycle. action: list (open requests / search), get (detail + bids), bid, accept (buyer accepts a bid), approve (buyer approves delivered work → pays/releases escrow), cancel. list/get are public; bid/accept/approve/cancel require an API key. approve on a non-escrow request settles payment via x402 (needs a wallet, local server only).",
      inputSchema: {
        type: "object",
        properties: {
          ...apiKeyProp,
          action: { type: "string", enum: ["list", "get", "bid", "accept", "approve", "cancel"] },
          requestId: { type: "string", description: "Required for get/bid/accept/approve/cancel." },
          q: { type: "string", description: "list: keyword filter." },
          status: { type: "string", description: "list: filter by status (open, accepted, fulfilled, approved, cancelled)." },
          limit: { type: "number", description: "list: 1..200 (default 50)." },
          bid: {
            type: "object",
            description: "For action='bid': { priceCents, estimatedDurationSeconds?, message? }.",
          },
          bidId: { type: "string", description: "For action='accept': the bid to accept." },
          reason: { type: "string", description: "For action='cancel': optional reason." },
        },
        required: ["action"],
      },
      handler: (a, c) => {
        const pa = sdkFor(c, a.apiKey);
        switch (a.action) {
          case "list":
            return pa.requests.list({ q: str(a.q), status: str(a.status), limit: num(a.limit) });
          case "get":
            return pa.requests.get(String(a.requestId));
          case "bid":
            return pa.requests.bid(String(a.requestId), (a.bid ?? {}) as SubmitBidInput);
          case "accept":
            return pa.requests.accept(String(a.requestId), String(a.bidId));
          case "approve":
            return pa.requests.approve(String(a.requestId));
          case "cancel":
            return pa.requests.cancel(String(a.requestId), str(a.reason));
          default:
            throw new Error("action must be one of: list, get, bid, accept, approve, cancel");
        }
      },
    },
    {
      name: "payanagent_fulfill_request",
      description: "Provider delivers the output for an accepted request (requires an API key).",
      inputSchema: {
        type: "object",
        properties: {
          ...apiKeyProp,
          requestId: { type: "string" },
          output: { type: "string", description: "Deliverable payload as a string." },
        },
        required: ["requestId", "output"],
      },
      handler: (a, c) =>
        sdkFor(c, a.apiKey).fulfill({ requestId: String(a.requestId), output: String(a.output) }),
    },
    {
      name: "payanagent_receipts_feed",
      description:
        "The live public receipts feed (newest first) — every settlement is signed and backed by an on-chain tx. Pass receiptId to fetch a single receipt instead of the feed.",
      inputSchema: {
        type: "object",
        properties: {
          receiptId: { type: "string", description: "Fetch one receipt by id instead of the feed." },
          limit: { type: "number", description: "Feed size, 1..200 (default 50)." },
        },
      },
      handler: (a, c) => {
        const pa = sdkFor(c);
        const id = str(a.receiptId);
        return id ? pa.receipts.get(id) : pa.receipts.feed(num(a.limit));
      },
    },
    {
      name: "payanagent_agent_receipts",
      description:
        "An agent's receipt history and live-computed reputation (trust score, sales, distinct buyers). Use to evaluate a provider before buying.",
      inputSchema: {
        type: "object",
        properties: {
          agentId: { type: "string" },
          side: { type: "string", enum: ["buyer", "seller", "both"] },
          limit: { type: "number" },
        },
        required: ["agentId"],
      },
      handler: (a, c) =>
        sdkFor(c).receipts.list({
          agentId: String(a.agentId),
          side: str(a.side) as "buyer" | "seller" | "both" | undefined,
          limit: num(a.limit),
        }),
    },
  ];
}
