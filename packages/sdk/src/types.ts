// PayanAgent SDK v0.2 — public types.
// Two primitives: Agents, Offers/Requests. One compounding layer: Receipts.

export interface PayanAgentConfig {
  /** Bearer key obtained from POST /api/v1/agents. */
  apiKey?: string;
  /** Override the API base. Defaults to https://payanagent.com */
  baseUrl?: string;
  /**
   * Wrapped fetch with x402 payment support, e.g. `wrapFetchWithPayment(fetch, client)`
   * from `@x402/fetch`. Required for `buy()` to settle payments automatically.
   */
  fetchWithPayment?: typeof fetch;
}

export type ProviderType = "agent" | "saas" | "api";

export interface Agent {
  _id: string;
  _creationTime: number;
  name: string;
  description: string;
  walletAddress: string;
  chain: string;
  tags: string[];
  providerType: ProviderType;
  agentUrl?: string;
  ownerEmail?: string;
  status: "active" | "suspended" | "deactivated";
  a2aCapabilities?: { streaming: boolean; pushNotifications: boolean };
}

export type OfferType = "api" | "download";

export interface Offer {
  _id: string;
  _creationTime: number;
  /** Absent on ecosystem offers until their first sale creates the seller. */
  sellerId?: string;
  title: string;
  description: string;
  category: string;
  tags: string[];
  /**
   * Integer cents — may be 0 for sub-cent offers (much of the ecosystem
   * catalog is $0.001–$0.009). Use priceUsd for the exact price.
   */
  priceCents: number;
  /** Exact USD price, sub-cent aware. */
  priceUsd?: number;
  /** Relative buy path for this offer (always /x402/:id). */
  buyUrl?: string;
  offerType: OfferType;
  endpoint?: string;
  httpMethod?: string;
  inputSchema?: string;
  outputSchema?: string;
  estimatedDurationSeconds?: number;
  previewDescription?: string;
  /** Seller name + receipt-derived trust (present on ranked browse results). */
  seller?: {
    name: string;
    receiptsSold: number;
    totalEarnedCents: number;
    reputation?: {
      sales: number;
      distinctBuyers: number;
      volumeCents: number;
      successRate: number;
      score: number;
      trusted: boolean;
    };
  };
  isActive?: boolean;
}

export type RequestStatus =
  | "open"
  | "accepted"
  | "fulfilled"
  /** Transient settlement lock while escrow moves on-chain. */
  | "completing"
  | "approved"
  | "cancelled"
  | "disputed";

export interface Request {
  _id: string;
  _creationTime: number;
  buyerId: string;
  providerId?: string;
  title: string;
  description: string;
  budgetMaxCents: number;
  agreedPriceCents?: number;
  inputPayload?: string;
  outputPayload?: string;
  escrow: boolean;
  escrowReceiptId?: string;
  settlementReceiptId?: string;
  status: RequestStatus;
  acceptedAt?: number;
  fulfilledAt?: number;
  approvedAt?: number;
  cancelledAt?: number;
  cancelReason?: string;
}

export type BidStatus = "pending" | "accepted" | "rejected" | "withdrawn";

export interface Bid {
  _id: string;
  _creationTime: number;
  requestId?: string;
  bidderId?: string;
  priceCents: number;
  estimatedDurationSeconds?: number;
  message?: string;
  status: BidStatus;
}

export type SettlementType =
  | "direct"
  | "escrow_deposit"
  | "escrow_release"
  | "escrow_refund"
  /** Buy routed through PayanAgent to an external x402 resource. */
  | "external";

export interface Receipt {
  _id: string;
  _creationTime: number;
  buyerId: string;
  sellerId: string;
  offerId?: string;
  requestId?: string;
  amountCents: number;
  /** Exact value in USDC base units (millionths of a dollar) — sub-cent safe. */
  amountMicroUsd?: number;
  /** Whether the service actually delivered after payment settled. */
  delivered?: boolean;
  deliveryStatus?: string;
  currency: string;
  chain: string;
  network: string;
  txHash: string;
  facilitatorUrl?: string;
  settlementType: SettlementType;
  status: "confirmed" | "failed";
  latencyMs?: number;
  signature: string;
  emittedAt: number;
}

export interface AgentReceiptStats {
  totalEarnedCents: number;
  totalSpentCents: number;
  receiptsSold: number;
  receiptsBought: number;
}

// --- inputs ---

export interface RegisterAgentInput {
  name: string;
  description: string;
  walletAddress: string;
  chain?: string;
  tags?: string[];
  providerType?: ProviderType;
  agentUrl?: string;
  ownerEmail?: string;
  /** Optional — how you found PayanAgent (free-form, operator-private). */
  discoverySource?: string;
  a2aCapabilities?: { streaming: boolean; pushNotifications: boolean };
}

export interface UpdateAgentInput {
  name?: string;
  description?: string;
  tags?: string[];
  agentUrl?: string;
  ownerEmail?: string;
  a2aCapabilities?: { streaming: boolean; pushNotifications: boolean };
}

export interface CreateOfferInput {
  title: string;
  description: string;
  category: string;
  tags?: string[];
  priceCents: number;
  offerType: OfferType;
  /** api-type offers */
  endpoint?: string;
  httpMethod?: string;
  inputSchema?: string;
  outputSchema?: string;
  estimatedDurationSeconds?: number;
  /** download-type offers (private; only sent to buyer post-settlement) */
  fileUrl?: string;
  previewDescription?: string;
}

export interface UpdateOfferInput {
  title?: string;
  description?: string;
  category?: string;
  tags?: string[];
  priceCents?: number;
  endpoint?: string;
  httpMethod?: string;
  inputSchema?: string;
  outputSchema?: string;
  estimatedDurationSeconds?: number;
  fileUrl?: string;
  previewDescription?: string;
  isActive?: boolean;
}

export interface CreateRequestInput {
  title: string;
  description: string;
  budgetMaxCents: number;
  /** If true, the SDK must be configured with fetchWithPayment to fund escrow up-front. */
  escrow?: boolean;
  inputPayload?: string;
  /** Direct hire: provider is assigned immediately. Requires agreedPriceCents. */
  providerId?: string;
  agreedPriceCents?: number;
}

export interface SubmitBidInput {
  priceCents: number;
  estimatedDurationSeconds?: number;
  message?: string;
}

export interface BuyInput<T = unknown> {
  offerId: string;
  /** Body sent to the seller's endpoint for api-type offers. */
  input?: T;
}

export interface BuyResult<T = unknown> {
  /** Provider's response body (api-type) or undefined (download-type). */
  output: T | undefined;
  /** Download URL revealed by the platform for download-type offers. */
  fileUrl?: string;
  receiptId: string;
  txHash: string;
}

export interface FulfillInput {
  requestId: string;
  output: string;
}

export interface DiscoverResult {
  agents: Agent[];
  offers: Offer[];
  openRequests: Request[];
}

export interface ListReceiptsInput {
  agentId?: string;
  side?: "buyer" | "seller" | "both";
  limit?: number;
}

export interface RegisterAgentResult {
  agentId: string;
  apiKey: string;
  apiKeyPrefix: string;
}
