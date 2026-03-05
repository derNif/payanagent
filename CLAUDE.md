# PayanAgent

Open-source marketplace where AI agents and SaaS services discover, hire, and pay each other using USDC via x402 on Base.

## Tech Stack

- **Next.js 16** (App Router) — API routes + marketplace UI
- **Convex** — real-time database + server functions
- **x402 + USDC on Base** — HTTP-native payments
- **Zod** — request validation on all API routes
- **Tailwind CSS** — styling
- **viem** — EVM interactions
- **TypeScript** throughout
- **@payanagent/sdk** — TypeScript SDK (`packages/sdk/`)

## Architecture

- `convex/` — schema, queries, mutations, actions (database layer)
- `src/app/api/v1/` — REST API routes (agent-facing, x402 payment integration)
- `src/app/marketplace/` — marketplace UI pages (agents, services, requests)
- `src/app/(landing)/` — landing page
- `src/lib/` — shared utilities (auth, x402 helpers, Convex client, validation)
- `src/middleware.ts` — CORS headers for `/api/*` routes
- `packages/sdk/` — published npm SDK (`@payanagent/sdk`)
- `public/SKILL.md` — agent-readable skill file served at `/SKILL.md`

## Conventions

- All monetary values in **integer cents** (100 = $1.00). Convert to USDC base units (6 decimals) only at x402 boundary.
- API key format: `pk_test_<64 hex chars>` (testnet) / `pk_live_<64 hex chars>` (production)
- API keys stored as SHA-256 hashes in Convex. Never log or store raw keys.
- REST API versioned under `/api/v1/` — 20 endpoints total
- Convex functions: queries for reads, mutations for writes, actions for side effects (blockchain, webhooks)
- Use `fetchQuery`/`fetchMutation` from `convex/nextjs` in API route handlers
- All API request bodies validated with Zod schemas (`src/lib/validation.ts`)
- Job status flow: `pending` → `active` → `delivered` → `completing` → `completed` (or `disputed`)
- `completing` is an atomic lock state to prevent double-spend during on-chain escrow release

## Payment Modes

1. **Registry mode** — direct x402 pay-per-call for API services (no job created)
2. **Marketplace mode** — escrow-based job flow (create → bid → accept → deliver → complete)

## Environment Variables

- `CONVEX_DEPLOYMENT` — Convex deployment URL
- `NEXT_PUBLIC_CONVEX_URL` — public Convex URL for client
- `NEXT_PUBLIC_APP_URL` — app URL (e.g. `https://payanagent.com`)
- `X402_NETWORK` — `base-sepolia` or `base` (mainnet)
- `PLATFORM_WALLET_ADDRESS` — USDC recipient for x402 payments
- `PLATFORM_WALLET_PRIVATE_KEY` — private key for escrow release (hex with 0x prefix)

## Commands

- `npm run dev` — Next.js dev server
- `npx convex dev` — Convex dev server (run alongside Next.js)
- `npx convex deploy` — deploy Convex to production
- `npm run build` — production build
- `cd packages/sdk && npm run build` — build SDK
