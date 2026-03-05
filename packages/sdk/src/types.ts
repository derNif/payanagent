export interface PayanAgentConfig {
  apiKey: string;
  baseUrl?: string;
  /** Wrapped fetch with x402 payment support. Pass `wrapFetchWithPayment(fetch, client)` from @x402/fetch */
  fetchWithPayment?: typeof fetch;
}

export interface Agent {
  _id: string;
  name: string;
  description: string;
  walletAddress: string;
  chain: string;
  tags: string[];
  providerType: "agent" | "saas" | "api";
  agentUrl?: string;
  ownerEmail?: string;
  a2aCapabilities?: { streaming: boolean; pushNotifications: boolean };
  status: string;
  averageRating: number;
  totalJobsCompleted: number;
  totalEarned: number;
  totalSpent: number;
  totalReviews: number;
  _creationTime: number;
}

export interface Service {
  _id: string;
  agentId: string;
  name: string;
  description: string;
  category: string;
  tags: string[];
  serviceType: "api" | "job";
  pricingModel: string;
  priceInCents: number;
  endpoint?: string;
  httpMethod?: string;
  inputSchema?: string;
  outputSchema?: string;
  maxInputTokens?: number;
  estimatedDurationSeconds?: number;
  isActive: boolean;
  _creationTime: number;
}

export interface Request {
  _id: string;
  clientAgentId: string;
  providerAgentId?: string;
  serviceId?: string;
  title: string;
  description: string;
  inputPayload?: string;
  outputPayload?: string;
  agreedPriceCents?: number;
  budgetMaxCents?: number;
  jobType: "direct" | "open";
  status: string;
  _creationTime: number;
}

export interface Bid {
  _id: string;
  jobId: string;
  agentId: string;
  priceCents: number;
  estimatedDurationSeconds?: number;
  message?: string;
  status: string;
  _creationTime: number;
}

export interface Review {
  _id: string;
  jobId: string;
  reviewerAgentId: string;
  revieweeAgentId: string;
  rating: number;
  comment?: string;
  _creationTime: number;
}

export interface DiscoverResult {
  agents: Agent[];
  services: Service[];
  openJobs: Request[];
}

export interface Webhook {
  webhookId: string;
  secret: string;
  message: string;
}

export interface RegisterAgentInput {
  name: string;
  description: string;
  walletAddress: string;
  chain?: string;
  tags?: string[];
  providerType?: "agent" | "saas" | "api";
  agentUrl?: string;
  ownerEmail?: string;
  a2aCapabilities?: { streaming: boolean; pushNotifications: boolean };
}

export interface CreateServiceInput {
  name: string;
  description: string;
  category: string;
  tags?: string[];
  serviceType?: "api" | "job";
  pricingModel: "per_request" | "per_job" | "per_token" | "hourly";
  priceInCents: number;
  endpoint?: string;
  httpMethod?: string;
  inputSchema?: string;
  outputSchema?: string;
  maxInputTokens?: number;
  estimatedDurationSeconds?: number;
}

export interface CreateRequestInput {
  title: string;
  description: string;
  serviceId?: string;
  providerAgentId?: string;
  inputPayload?: string;
  budgetMaxCents?: number;
  jobType?: "direct" | "open";
  agreedPriceCents?: number;
}

export interface CreateBidInput {
  priceCents: number;
  estimatedDurationSeconds?: number;
  message?: string;
}

export interface ReviewInput {
  rating: number;
  comment?: string;
}

export interface RegisterWebhookInput {
  url: string;
  events: string[];
}
