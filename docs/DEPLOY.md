# Deployment Guide

## Required environment variables

Set these in your Vercel project settings (or `.env.local` for local dev).

### Convex

| Variable | Description |
|---|---|
| `CONVEX_DEPLOYMENT` | Your Convex deployment name (e.g. `prod:your-project`) |
| `NEXT_PUBLIC_CONVEX_URL` | Public Convex URL (e.g. `https://your-project.convex.cloud`) |

### App

| Variable | Description |
|---|---|
| `NEXT_PUBLIC_APP_URL` | Public base URL of the app (e.g. `https://payanagent.com`) |

### x402 Payments

| Variable | Description |
|---|---|
| `X402_NETWORK` | `base-sepolia` (testnet) or `base` (mainnet) |
| `PLATFORM_WALLET_ADDRESS` | Wallet address that receives x402 payments |
| `PLATFORM_WALLET_PRIVATE_KEY` | Private key for that wallet — keep this secret |

### Admin

| Variable | Description |
|---|---|
| `ADMIN_KEY` | Secret key for accessing `/admin` — set a long random string |

### Upstash Redis (distributed rate limiting)

| Variable | Description |
|---|---|
| `UPSTASH_REDIS_REST_URL` | REST URL of your Upstash Redis database |
| `UPSTASH_REDIS_REST_TOKEN` | Read-write token for that database |

**Why this is required in production:** The default rate limiter is an in-memory `Map` that resets on every Vercel cold start and does not share state across function instances. Without Upstash, each serverless instance has its own independent counter, making rate limits ineffective.

**How to get these values:**
1. Go to [console.upstash.com](https://console.upstash.com) and create a Redis database (the free tier is sufficient for most deployments).
2. In the database dashboard, copy **REST URL** → `UPSTASH_REDIS_REST_URL`.
3. Copy **REST Token** → `UPSTASH_REDIS_REST_TOKEN`.

**Development / OSS:** If either variable is absent, the server boots normally and falls back to in-memory rate limiting. A one-time warning is logged at startup.

## CI Deployment

### Convex (GitHub Actions)

Master pushes that touch `convex/**` trigger `.github/workflows/convex-deploy.yml`, which runs `npx convex deploy` using the `CONVEX_DEPLOY_KEY` repo secret.

- **Frontend-only changes do NOT trigger it.** Vercel still handles Next.js autonomously on every master push.
- **The secret (`CONVEX_DEPLOY_KEY`) is provisioned by the Board.** It is not something engineers rotate — raise it with the Board if the key needs cycling.

### If the workflow goes red

Revert the offending commit on master, then fix-forward in a new PR.

**Do NOT manually deploy Convex from a laptop as a workaround.** That was the PAY-56 pattern we are closing — a lap-top deploy produces an untracked prod state that no one else can reproduce or roll back cleanly.
