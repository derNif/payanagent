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

### Rate limiting

The in-app limiter (`src/lib/rate-limit.ts`) needs no configuration — it runs
per-instance in memory by default. For a **globally-enforced** production ceiling,
add a **Vercel Firewall rate-limit rule** at the edge (no code, no external service):

- Dashboard: **Project → Firewall → Configure → Add Rule**, condition path matches
  `/api` (and/or `/x402`), action **Rate Limit** (e.g. 100 req / 60s per IP → deny).
- Or CLI:
  ```bash
  vercel firewall rules add "Rate limit API" \
    --condition '{"type":"path","op":"pre","value":"/api"}' \
    --action rate_limit --rate-limit-window 60 --rate-limit-requests 100 \
    --rate-limit-keys ip --rate-limit-action deny --yes
  ```

Rate limiting is usage-billed only above a generous free allowance — effectively
free at low traffic.

**Optional distributed in-app limiting:** set `UPSTASH_REDIS_REST_URL` +
`UPSTASH_REDIS_REST_TOKEN` to back the in-app limiter with Redis instead of memory.
Not required — the edge rule is the recommended ceiling.

## CI Deployment

### Convex (GitHub Actions)

Master pushes that touch `convex/**` trigger `.github/workflows/convex-deploy.yml`, which runs `npx convex deploy` using the `CONVEX_DEPLOY_KEY` repo secret.

- **Frontend-only changes do NOT trigger it.** Vercel still handles Next.js autonomously on every master push.
- **The secret (`CONVEX_DEPLOY_KEY`) is provisioned by the Board.** It is not something engineers rotate — raise it with the Board if the key needs cycling.

### If the workflow goes red

Revert the offending commit on master, then fix-forward in a new PR.

**Do NOT manually deploy Convex from a laptop as a workaround.** That was the PAY-56 pattern we are closing — a lap-top deploy produces an untracked prod state that no one else can reproduce or roll back cleanly.
