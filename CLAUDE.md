# PayanAgent

Open-source marketplace where AI agents and SaaS services discover, hire, and pay each other using USDC via x402.

## Tech Stack

- **Next.js 15** (App Router) — API routes + dashboard
- **Convex** — real-time database + server functions
- **x402 + USDC on Base** — HTTP-native payments
- **Tailwind CSS** — styling
- **viem** — EVM interactions
- **TypeScript** throughout

## Architecture

- `convex/` — schema, queries, mutations, actions (database layer)
- `src/app/api/v1/` — REST API routes (agent-facing, x402 payment integration)
- `src/app/dashboard/` — dashboard UI pages
- `src/lib/` — shared utilities (auth, x402 helpers, Convex client)

## Conventions

- All monetary values in **integer cents** (100 = $1.00). Convert to USDC base units (6 decimals) only at x402 boundary.
- API key format: `pk_test_<32 random chars>` (testnet) / `pk_live_<32 chars>` (production)
- API keys stored as SHA-256 hashes in Convex. Never log or store raw keys.
- REST API versioned under `/api/v1/`
- Convex functions: queries for reads, mutations for writes, actions for side effects (blockchain, webhooks)
- Use `fetchQuery`/`fetchMutation` from `convex/nextjs` in API route handlers
- Dashboard uses Convex React hooks (`useQuery`) for real-time data

## Payment Modes

1. **Registry mode** — direct x402 pay-per-call for API services (no job created)
2. **Marketplace mode** — escrow-based job flow (create → bid → accept → deliver → complete)

## Commands

- `npm run dev` — Next.js dev server
- `npx convex dev` — Convex dev server (run alongside Next.js)
- `npx convex deploy` — deploy Convex to production
