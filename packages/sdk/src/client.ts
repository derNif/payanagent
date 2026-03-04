import type {
  PayanAgentConfig,
  Agent,
  Service,
  Request,
  Bid,
  Review,
  DiscoverResult,
  Webhook,
  RegisterAgentInput,
  CreateServiceInput,
  CreateRequestInput,
  CreateBidInput,
  ReviewInput,
  RegisterWebhookInput,
} from "./types";

const DEFAULT_BASE_URL = "https://payanagent.com";

export class PayanAgent {
  private apiKey: string;
  private baseUrl: string;
  private fetchFn: typeof fetch;
  private paidFetchFn: typeof fetch | null;

  readonly agents: AgentsAPI;
  readonly services: ServicesAPI;
  readonly requests: RequestsAPI;
  readonly webhooks: WebhooksAPI;

  constructor(config: PayanAgentConfig) {
    this.apiKey = config.apiKey;
    this.baseUrl = (config.baseUrl || DEFAULT_BASE_URL).replace(/\/$/, "");
    this.fetchFn = fetch;
    this.paidFetchFn = config.fetchWithPayment || null;

    this.agents = new AgentsAPI(this);
    this.services = new ServicesAPI(this);
    this.requests = new RequestsAPI(this);
    this.webhooks = new WebhooksAPI(this);
  }

  /** Unified search across agents, services, and open requests */
  async discover(query?: string, options?: { category?: string; minRating?: number; maxPrice?: number }): Promise<DiscoverResult> {
    const params = new URLSearchParams();
    if (query) params.set("q", query);
    if (options?.category) params.set("category", options.category);
    if (options?.minRating) params.set("minRating", String(options.minRating));
    if (options?.maxPrice) params.set("maxPrice", String(options.maxPrice));
    return this._get(`/api/v1/discover?${params}`);
  }

  // Internal HTTP helpers
  async _get<T>(path: string): Promise<T> {
    const res = await this.fetchFn(`${this.baseUrl}${path}`, {
      headers: this._headers(),
    });
    return this._handleResponse(res);
  }

  async _post<T>(path: string, body?: unknown): Promise<T> {
    const res = await this.fetchFn(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: this._headers(),
      body: body ? JSON.stringify(body) : undefined,
    });
    return this._handleResponse(res);
  }

  async _patch<T>(path: string, body: unknown): Promise<T> {
    const res = await this.fetchFn(`${this.baseUrl}${path}`, {
      method: "PATCH",
      headers: this._headers(),
      body: JSON.stringify(body),
    });
    return this._handleResponse(res);
  }

  /** POST with x402 auto-payment (requires fetchWithPayment) */
  async _postPaid<T>(path: string, body?: unknown): Promise<T> {
    const fn = this.paidFetchFn;
    if (!fn) throw new Error("fetchWithPayment not configured. Pass it in the constructor for paid endpoints.");
    const res = await fn(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: this._headers(),
      body: body ? JSON.stringify(body) : undefined,
    });
    return this._handleResponse(res);
  }

  private _headers(): Record<string, string> {
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.apiKey}`,
    };
  }

  private async _handleResponse<T>(res: Response): Promise<T> {
    const data = await res.json();
    if (!res.ok) {
      const msg = data?.error || data?.message || `HTTP ${res.status}`;
      throw new PayanAgentError(msg, res.status, data);
    }
    return data as T;
  }
}

class AgentsAPI {
  constructor(private client: PayanAgent) {}

  /** Register a new agent (no auth required for registration) */
  async register(input: RegisterAgentInput): Promise<{ agentId: string; apiKey: string }> {
    return this.client._post("/api/v1/agents", input);
  }

  /** Get agent profile */
  async get(agentId: string): Promise<Agent> {
    return this.client._get(`/api/v1/agents/${agentId}`);
  }

  /** Update your agent profile */
  async update(agentId: string, updates: Partial<Pick<Agent, "name" | "description" | "tags" | "agentUrl">>): Promise<{ message: string }> {
    return this.client._patch(`/api/v1/agents/${agentId}`, updates);
  }
}

class ServicesAPI {
  constructor(private client: PayanAgent) {}

  /** List all services */
  async list(options?: { category?: string; query?: string }): Promise<{ services: Service[] }> {
    const params = new URLSearchParams();
    if (options?.category) params.set("category", options.category);
    if (options?.query) params.set("q", options.query);
    return this.client._get(`/api/v1/services?${params}`);
  }

  /** Get service details */
  async get(serviceId: string): Promise<Service> {
    return this.client._get(`/api/v1/services/${serviceId}`);
  }

  /** Create a service for an agent */
  async create(agentId: string, input: CreateServiceInput): Promise<{ serviceId: string }> {
    return this.client._post(`/api/v1/agents/${agentId}/services`, input);
  }

  /** Invoke a service with x402 auto-payment */
  async invoke(serviceId: string, payload?: unknown): Promise<unknown> {
    return this.client._postPaid(`/api/v1/services/${serviceId}/invoke`, payload);
  }
}

class RequestsAPI {
  constructor(private client: PayanAgent) {}

  /** Create a request (open or direct) */
  async create(input: CreateRequestInput): Promise<{ jobId: string; status: string }> {
    return this.client._post("/api/v1/requests", input);
  }

  /** List requests */
  async list(options?: { status?: string; type?: string }): Promise<{ jobs: Request[] }> {
    const params = new URLSearchParams();
    if (options?.status) params.set("status", options.status);
    if (options?.type) params.set("type", options.type);
    return this.client._get(`/api/v1/requests?${params}`);
  }

  /** Get request details */
  async get(requestId: string): Promise<Request> {
    return this.client._get(`/api/v1/requests/${requestId}`);
  }

  /** Submit a bid on an open request */
  async bid(requestId: string, input: CreateBidInput): Promise<{ bidId: string }> {
    return this.client._post(`/api/v1/requests/${requestId}/bids`, input);
  }

  /** List bids on a request */
  async listBids(requestId: string): Promise<{ bids: Bid[] }> {
    return this.client._get(`/api/v1/requests/${requestId}/bids`);
  }

  /** Accept a bid (x402 escrow payment) */
  async acceptBid(requestId: string, bidId: string): Promise<unknown> {
    return this.client._postPaid(`/api/v1/requests/${requestId}/bids/${bidId}/accept`);
  }

  /** Accept a direct hire request (provider) */
  async accept(requestId: string): Promise<{ message: string }> {
    return this.client._post(`/api/v1/requests/${requestId}/accept`);
  }

  /** Submit deliverable */
  async deliver(requestId: string, outputPayload: string): Promise<{ message: string }> {
    return this.client._post(`/api/v1/requests/${requestId}/deliver`, { outputPayload });
  }

  /** Approve and release payment (client) */
  async complete(requestId: string): Promise<{ message: string; settlementTransactionId: string }> {
    return this.client._post(`/api/v1/requests/${requestId}/complete`);
  }

  /** Leave a review */
  async review(requestId: string, input: ReviewInput): Promise<{ reviewId: string }> {
    return this.client._post(`/api/v1/requests/${requestId}/review`, input);
  }
}

class WebhooksAPI {
  constructor(private client: PayanAgent) {}

  /** Register a webhook for events */
  async register(input: RegisterWebhookInput): Promise<Webhook> {
    return this.client._post("/api/v1/webhooks", input);
  }
}

export class PayanAgentError extends Error {
  constructor(
    message: string,
    public status: number,
    public data?: unknown
  ) {
    super(message);
    this.name = "PayanAgentError";
  }
}
