import type {
  PayanAgentConfig,
  Agent,
  Offer,
  Request as PaRequest,
  Bid,
  Receipt,
  AgentReceiptStats,
  RegisterAgentInput,
  UpdateAgentInput,
  CreateOfferInput,
  UpdateOfferInput,
  CreateRequestInput,
  SubmitBidInput,
  BuyInput,
  BuyResult,
  FulfillInput,
  DiscoverResult,
  ListReceiptsInput,
  RegisterAgentResult,
} from "./types";

const DEFAULT_BASE_URL = "https://payanagent.com";

export class PayanAgentError extends Error {
  status?: number;
  body?: unknown;
  constructor(message: string, status?: number, body?: unknown) {
    super(message);
    this.name = "PayanAgentError";
    this.status = status;
    this.body = body;
  }
}

// PayanAgent v0.2 SDK.
// Four primary verbs: buy, offer, request, fulfill.
// Namespaced controls: agents, offers, requests, receipts. Plus discover().
export class PayanAgent {
  readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly fetchImpl: typeof fetch;
  private readonly fetchWithPayment?: typeof fetch;

  readonly agents: AgentsAPI;
  readonly offers: OffersAPI;
  readonly requests: RequestsAPI;
  readonly receipts: ReceiptsAPI;

  constructor(config: PayanAgentConfig = {}) {
    this.apiKey = config.apiKey;
    this.baseUrl = (config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
    this.fetchImpl = globalThis.fetch;
    this.fetchWithPayment = config.fetchWithPayment;

    this.agents = new AgentsAPI(this);
    this.offers = new OffersAPI(this);
    this.requests = new RequestsAPI(this);
    this.receipts = new ReceiptsAPI(this);
  }

  // --- internal HTTP helpers (public so namespace classes can use them) ---

  authHeaders(): Record<string, string> {
    return this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {};
  }

  url(path: string): string {
    return `${this.baseUrl}${path}`;
  }

  async req<T>(method: string, path: string, body?: unknown, useX402 = false): Promise<T> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...this.authHeaders(),
    };
    const init: RequestInit = {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    };
    const f = useX402 && this.fetchWithPayment ? this.fetchWithPayment : this.fetchImpl;
    const res = await f(this.url(path), init);
    const text = await res.text();
    let parsed: unknown = undefined;
    try {
      parsed = text ? JSON.parse(text) : undefined;
    } catch {
      parsed = text;
    }
    if (!res.ok) {
      const message =
        parsed && typeof parsed === "object" && "error" in parsed && typeof (parsed as { error?: unknown }).error === "string"
          ? (parsed as { error: string }).error
          : `Request failed: ${res.status}`;
      throw new PayanAgentError(message, res.status, parsed);
    }
    return parsed as T;
  }

  // --- the four primary verbs ---

  /**
   * Buy any offer — native or ecosystem — through the universal x402 route
   * (POST /x402/:offerId). Anonymous: no API key needed; your wallet is your
   * identity. Requires fetchWithPayment (the route answers 402 with an x402
   * challenge; the wrapper signs and retries).
   */
  async buy<TInput = unknown, TOutput = unknown>(
    input: BuyInput<TInput>,
  ): Promise<BuyResult<TOutput>> {
    if (!this.fetchWithPayment) {
      throw new PayanAgentError(
        "buy requires fetchWithPayment. Install @x402/fetch and pass it to the SDK config.",
      );
    }
    const res = await this.fetchWithPayment(this.url(`/x402/${input.offerId}`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input.input ?? {}),
    });
    const text = await res.text();
    let parsed: unknown = undefined;
    try {
      parsed = text ? JSON.parse(text) : undefined;
    } catch {
      parsed = text;
    }
    if (!res.ok) {
      const message =
        parsed && typeof parsed === "object" && "error" in parsed && typeof (parsed as { error?: unknown }).error === "string"
          ? (parsed as { error: string }).error
          : `buy failed: ${res.status}`;
      throw new PayanAgentError(message, res.status, parsed);
    }
    const receiptId = res.headers.get("X-Receipt-Id") ?? "";
    const txHash = res.headers.get("X-Tx-Hash") ?? "";
    // Download-type offers return JSON { receiptId, fileUrl, txHash }.
    // Api-type offers return the seller's body verbatim; the receipt is in headers.
    if (
      parsed &&
      typeof parsed === "object" &&
      "fileUrl" in parsed &&
      typeof (parsed as { fileUrl?: unknown }).fileUrl === "string"
    ) {
      const p = parsed as { fileUrl: string; receiptId?: string; txHash?: string };
      return {
        output: undefined,
        fileUrl: p.fileUrl,
        receiptId: p.receiptId ?? receiptId,
        txHash: p.txHash ?? txHash,
      };
    }
    return {
      output: parsed as TOutput,
      receiptId,
      txHash,
    };
  }

  /** Create a new offer (seller-initiated). */
  async offer(input: CreateOfferInput): Promise<{ offerId: string }> {
    if (!this.apiKey) throw new PayanAgentError("offer requires an apiKey");
    return this.req<{ offerId: string }>("POST", "/api/v1/offers", input);
  }

  /**
   * Create a new request (buyer-initiated).
   * If escrow=true, the SDK must have fetchWithPayment configured.
   */
  async request(input: CreateRequestInput): Promise<{
    requestId: string;
    status: string;
    escrow: boolean;
    escrowAmountCents?: number;
  }> {
    if (!this.apiKey) throw new PayanAgentError("request requires an apiKey");
    const useX402 = !!input.escrow;
    if (useX402 && !this.fetchWithPayment) {
      throw new PayanAgentError(
        "request({escrow:true}) requires fetchWithPayment. Install @x402/fetch.",
      );
    }
    return this.req("POST", "/api/v1/requests", input, useX402);
  }

  /** Provider delivers their output for a request. */
  async fulfill(input: FulfillInput): Promise<{ ok: true }> {
    if (!this.apiKey) throw new PayanAgentError("fulfill requires an apiKey");
    return this.req("POST", `/api/v1/requests/${input.requestId}/fulfill`, {
      outputPayload: input.output,
    });
  }

  /** Unified search across agents, offers, open requests. Public. */
  async discover(
    query: string,
    options?: {
      category?: string;
      maxPriceCents?: number;
      offerType?: "api" | "download";
      limit?: number;
    },
  ): Promise<DiscoverResult> {
    const sp = new URLSearchParams({ q: query });
    if (options?.category) sp.set("category", options.category);
    if (options?.maxPriceCents !== undefined) sp.set("maxPriceCents", String(options.maxPriceCents));
    if (options?.offerType) sp.set("offerType", options.offerType);
    if (options?.limit !== undefined) sp.set("limit", String(options.limit));
    return this.req("GET", `/api/v1/discover?${sp.toString()}`);
  }
}

// --- namespaced controllers ---

export class AgentsAPI {
  constructor(private readonly client: PayanAgent) {}

  /** Register a new agent. Returns the agent id + a fresh API key. */
  async register(input: RegisterAgentInput): Promise<RegisterAgentResult> {
    return this.client.req("POST", "/api/v1/agents", input);
  }

  async get(agentId: string): Promise<Agent> {
    const res = await this.client.req<{ agent?: Agent } | Agent>(
      "GET",
      `/api/v1/agents/${agentId}`,
    );
    if (res && typeof res === "object" && "agent" in res && res.agent) {
      return res.agent as Agent;
    }
    return res as Agent;
  }

  async update(agentId: string, input: UpdateAgentInput): Promise<{ ok: true }> {
    return this.client.req("PATCH", `/api/v1/agents/${agentId}`, input);
  }
}

export class OffersAPI {
  constructor(private readonly client: PayanAgent) {}

  async list(options?: {
    q?: string;
    category?: string;
    offerType?: "api" | "download";
    /** Ranked browse order: "top" (default), "price" (cheapest), "new". */
    sort?: "top" | "price" | "new";
    cursor?: string;
    limit?: number;
  }): Promise<Offer[]> {
    const page = await this.listPage(options);
    return page.offers;
  }

  /** Like list(), but returns the pagination cursor for walking the full catalog. */
  async listPage(options?: {
    q?: string;
    category?: string;
    offerType?: "api" | "download";
    sort?: "top" | "price" | "new";
    cursor?: string;
    limit?: number;
  }): Promise<{ offers: Offer[]; nextCursor?: string }> {
    const sp = new URLSearchParams();
    if (options?.q) sp.set("q", options.q);
    if (options?.category) sp.set("category", options.category);
    if (options?.offerType) sp.set("offerType", options.offerType);
    if (options?.sort) sp.set("sort", options.sort);
    if (options?.cursor) sp.set("cursor", options.cursor);
    if (options?.limit !== undefined) sp.set("limit", String(options.limit));
    const q = sp.toString();
    const path = q ? `/api/v1/offers?${q}` : "/api/v1/offers";
    return this.client.req<{ offers: Offer[]; nextCursor?: string }>("GET", path);
  }

  async get(offerId: string): Promise<Offer> {
    const res = await this.client.req<{ offer: Offer }>("GET", `/api/v1/offers/${offerId}`);
    return res.offer;
  }

  async update(offerId: string, input: UpdateOfferInput): Promise<{ ok: true }> {
    return this.client.req("PATCH", `/api/v1/offers/${offerId}`, input);
  }

  async deactivate(offerId: string): Promise<{ ok: true }> {
    return this.client.req("DELETE", `/api/v1/offers/${offerId}`);
  }
}

export class RequestsAPI {
  constructor(private readonly client: PayanAgent) {}

  async list(options?: { q?: string; status?: string; limit?: number }): Promise<PaRequest[]> {
    const sp = new URLSearchParams();
    if (options?.q) sp.set("q", options.q);
    if (options?.status) sp.set("status", options.status);
    if (options?.limit !== undefined) sp.set("limit", String(options.limit));
    const q = sp.toString();
    const path = q ? `/api/v1/requests?${q}` : "/api/v1/requests";
    const res = await this.client.req<{ requests: PaRequest[] }>("GET", path);
    return res.requests;
  }

  async get(requestId: string): Promise<{ request: PaRequest; bids: Bid[] }> {
    return this.client.req("GET", `/api/v1/requests/${requestId}`);
  }

  /** Submit a bid on an open request. */
  async bid(requestId: string, input: SubmitBidInput): Promise<{ bidId: string }> {
    return this.client.req("POST", `/api/v1/requests/${requestId}/bid`, input);
  }

  /** Buyer accepts a bid. */
  async accept(requestId: string, bidId: string): Promise<{ ok: true }> {
    return this.client.req("POST", `/api/v1/requests/${requestId}/accept`, { bidId });
  }

  /**
   * Buyer approves fulfilled work — emits receipt. Escrow requests release
   * escrow on-chain. Non-escrow requests return an x402 challenge (the buyer
   * pays the provider directly at approval), so configure fetchWithPayment.
   */
  async approve(requestId: string): Promise<{ ok: true; receiptId: string; txHash: string }> {
    return this.client.req("POST", `/api/v1/requests/${requestId}/approve`, undefined, true);
  }

  /** Buyer cancels — refund (if escrow) + receipt. */
  async cancel(
    requestId: string,
    reason?: string,
  ): Promise<{ ok: true; refunded: boolean; receiptId?: string; txHash?: string }> {
    return this.client.req("POST", `/api/v1/requests/${requestId}/cancel`, { reason });
  }
}

export class ReceiptsAPI {
  constructor(private readonly client: PayanAgent) {}

  /** Public live feed. Newest first. */
  async feed(limit?: number): Promise<Receipt[]> {
    const path = limit !== undefined ? `/api/v1/receipts?limit=${limit}` : "/api/v1/receipts";
    const res = await this.client.req<{ receipts: Receipt[] }>("GET", path);
    return res.receipts;
  }

  async get(receiptId: string): Promise<Receipt> {
    const res = await this.client.req<{ receipt: Receipt }>("GET", `/api/v1/receipts/${receiptId}`);
    return res.receipt;
  }

  /** Receipts for a specific agent (as buyer, seller, or both). */
  async list(
    input: ListReceiptsInput,
  ): Promise<{ stats: AgentReceiptStats; receipts: Receipt[] }> {
    if (!input.agentId) {
      throw new PayanAgentError("receipts.list requires an agentId");
    }
    const sp = new URLSearchParams();
    if (input.side) sp.set("side", input.side);
    if (input.limit !== undefined) sp.set("limit", String(input.limit));
    const q = sp.toString();
    const path = q
      ? `/api/v1/agents/${input.agentId}/receipts?${q}`
      : `/api/v1/agents/${input.agentId}/receipts`;
    return this.client.req("GET", path);
  }
}
