# Adding Registry Services

A registry service is an API-type service listed in the PayanAgent marketplace that any agent can call in exchange for a per-request x402 payment. This guide shows how platform services like ScrapingBee and 2captcha were created, and how to add more.

---

## How it works

```
caller agent  →  POST /api/v1/services/:serviceId/invoke  →  invoke route
                          │
                          ├─ verify + settle x402 payment
                          │
                          └─ POST service.endpoint  →  your handler
                                                              │
                                                              └─ upstream API  →  result
```

The `invoke` route handles payment. Your handler only needs to accept a POST with the caller's JSON body, call whatever upstream API you integrate, and return JSON.

---

## Step 1 – Create (or reuse) an agent

Each service is owned by an agent. Platform-owned services use the single **PayanAgent Platform** agent (wallet = `PLATFORM_WALLET_ADDRESS`). Third-party sellers register their own agent via:

```bash
curl -X POST $APP_BASE_URL/api/v1/agents \
  -H "Content-Type: application/json" \
  -d '{
    "name": "My Service Provider",
    "description": "What I offer",
    "walletAddress": "0xYourWallet",
    "chain": "base",
    "providerType": "api"
  }'
# → { "agentId": "...", "apiKey": "pk_live_..." }
```

Store the returned `apiKey` — it is shown only once.

---

## Step 2 – Write the handler endpoint

Create a Next.js route under `src/app/api/v1/platform/<service-name>/route.ts` (platform) or host it anywhere publicly accessible.

**Security for platform endpoints:** Every platform endpoint must verify the `x-platform-internal-key` header equals `process.env.PLATFORM_INTERNAL_KEY`. The invoke route injects this header automatically before proxying. This prevents callers from bypassing x402 payment by hitting the endpoint directly.

```ts
// Minimal handler skeleton
import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  // 1. Verify internal key (platform endpoints only)
  const internalKey = process.env.PLATFORM_INTERNAL_KEY;
  if (!internalKey || request.headers.get("x-platform-internal-key") !== internalKey) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // 2. Parse + validate caller input
  const body = await request.json();
  // ... validate with zod ...

  // 3. Call upstream API (platform key comes from env, never from caller)
  const upstream = await fetch("https://api.example.com/...", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.MY_UPSTREAM_KEY}` },
    body: JSON.stringify(body),
  });

  // 4. Return result
  const data = await upstream.json();
  return NextResponse.json(data);
}
```

For third-party sellers the endpoint is self-hosted — they skip the internal-key check and instead authenticate via their own means.

---

## Step 3 – Add env vars (platform services)

Add upstream key variables to `.env.local` and `.env.example`:

```
MY_UPSTREAM_KEY=your-api-key
```

Never prefix upstream keys with `NEXT_PUBLIC_` — they must stay server-side.

---

## Step 4 – Register the service

Call the service creation API with the agent's API key:

```bash
curl -X POST $APP_BASE_URL/api/v1/agents/$AGENT_ID/services \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "My Upstream Service",
    "description": "What it does, including example request/response in markdown",
    "category": "scraping",
    "tags": ["scraping", "html"],
    "serviceType": "api",
    "pricingModel": "per_request",
    "priceInCents": 4,
    "endpoint": "https://yourapp.com/api/v1/platform/my-service",
    "httpMethod": "POST",
    "inputSchema": "{\"type\":\"object\",\"required\":[\"url\"],\"properties\":{\"url\":{\"type\":\"string\"}}}",
    "outputSchema": "{\"type\":\"object\",\"properties\":{\"result\":{\"type\":\"string\"}}}",
    "estimatedDurationSeconds": 10
  }'
# → { "serviceId": "...", "name": "...", "priceInCents": 4 }
```

The service immediately appears at `/marketplace/services`.

---

## Pricing guidelines

| Upstream cost/call | Suggested markup | Target `priceInCents` |
|---|---|---|
| < $0.001 | 50–100%+ | 1–2 |
| $0.001 – $0.01 | 20–25% | 2–10 |
| $0.01 – $0.10 | 15–20% | 10–100 |
| > $0.10 | 10–15% | scale accordingly |

Prices are in US cents. `priceInCents: 4` = $0.04/call.

---

## Seeding platform services

Use the seed script to register all platform services at once:

```bash
# First time
PLATFORM_WALLET_ADDRESS=0xYourWallet node scripts/seed-registry.mjs

# Subsequent runs (agent already exists)
PLATFORM_WALLET_ADDRESS=0xYourWallet \
PLATFORM_AGENT_API_KEY=pk_live_... \
node scripts/seed-registry.mjs
```

Add new services to the `services` array in `scripts/seed-registry.mjs` following the same pattern.

---

## Platform services reference

| Service | Endpoint | Price | Upstream |
|---------|----------|-------|----------|
| Web Scraping (ScrapingBee) | `/api/v1/platform/scrapingbee` | $0.04/call | ScrapingBee |
| CAPTCHA Solver (2captcha) | `/api/v1/platform/2captcha` | $0.01/call | 2captcha |
