/**
 * Seed the registry with the two platform-owned services:
 *   1. ScrapingBee web-scraping wrapper
 *   2. 2captcha CAPTCHA-solving wrapper
 *
 * Prerequisites:
 *   - App server running:   npm run dev  (default http://localhost:3000)
 *   - Convex dev running:   npx convex dev
 *   - .env.local populated with PLATFORM_WALLET_ADDRESS and NEXT_PUBLIC_APP_URL
 *
 * Usage:
 *   node scripts/seed-registry.mjs
 *
 * Environment variables:
 *   APP_BASE_URL            Base URL of the running app (default: NEXT_PUBLIC_APP_URL or http://localhost:3000)
 *   PLATFORM_WALLET_ADDRESS Wallet address for the platform agent (required)
 *   PLATFORM_OWNER_EMAIL    Optional contact email for the platform agent
 *
 * Idempotent: safe to run multiple times. Skips creation if a platform agent
 * with the same wallet address already exists (detected via 409 or search).
 */

import { readFileSync } from "fs";
import { resolve } from "path";

// ── Load .env.local if present ───────────────────────────────────────────────
const envPath = resolve(process.cwd(), ".env.local");
try {
  const raw = readFileSync(envPath, "utf8");
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    const val = trimmed.slice(idx + 1).trim().replace(/^["']|["']$/g, "");
    if (!process.env[key]) process.env[key] = val;
  }
} catch {
  // .env.local is optional
}

const BASE_URL =
  process.env.APP_BASE_URL ||
  process.env.NEXT_PUBLIC_APP_URL ||
  "http://localhost:3000";

const PLATFORM_WALLET = process.env.PLATFORM_WALLET_ADDRESS;
if (!PLATFORM_WALLET || !PLATFORM_WALLET.match(/^0x[a-fA-F0-9]{40}$/)) {
  console.error("PLATFORM_WALLET_ADDRESS is required and must be a valid 0x address.");
  process.exit(1);
}

// ── Helpers ──────────────────────────────────────────────────────────────────

async function apiPost(path, body, apiKey) {
  const headers = { "Content-Type": "application/json" };
  if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;
  const res = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const json = await res.json();
  return { status: res.status, body: json };
}

async function apiGet(path, apiKey) {
  const headers = {};
  if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;
  const res = await fetch(`${BASE_URL}${path}`, { headers });
  const json = await res.json();
  return { status: res.status, body: json };
}

// ── Step 1: Register (or retrieve) the platform agent ────────────────────────

console.log("\n=== Seeding registry services ===");
console.log(`App: ${BASE_URL}`);

let agentId, apiKey;

// Try registering a new agent
const regRes = await apiPost("/api/v1/agents", {
  name: "PayanAgent Platform",
  description:
    "Official platform services by PayanAgent. Provides pay-per-call access to best-in-class " +
    "external APIs including web scraping (ScrapingBee) and CAPTCHA solving (2captcha). " +
    "All upstream API keys are custodied by the platform — callers only need a wallet balance.",
  walletAddress: PLATFORM_WALLET,
  chain: "base",
  tags: ["platform", "scraping", "captcha", "official"],
  providerType: "api",
  ownerEmail: process.env.PLATFORM_OWNER_EMAIL,
});

if (regRes.status === 201) {
  agentId = regRes.body.agentId;
  apiKey = regRes.body.apiKey;
  console.log(`\n✓ Platform agent created`);
  console.log(`  agentId : ${agentId}`);
  console.log(`  apiKey  : ${apiKey}`);
  console.log(`  !! Save this API key — it will not be shown again !!`);
} else if (regRes.status === 409 || regRes.body?.error?.includes("wallet")) {
  // Wallet already registered — operator must supply the existing key via env
  const existingKey = process.env.PLATFORM_AGENT_API_KEY;
  if (!existingKey) {
    console.error(
      "\nPlatform agent with this wallet address already exists.\n" +
      "Set PLATFORM_AGENT_API_KEY to the existing key and re-run."
    );
    process.exit(1);
  }
  apiKey = existingKey;
  // Resolve agentId from /me
  const meRes = await apiGet("/api/v1/agents/me", apiKey);
  if (meRes.status !== 200) {
    console.error("Could not resolve existing agent:", meRes.body);
    process.exit(1);
  }
  agentId = meRes.body.id ?? meRes.body.agentId;
  console.log(`\n✓ Using existing platform agent: ${agentId}`);
} else {
  console.error("\nFailed to register platform agent:", regRes.body);
  process.exit(1);
}

// ── Step 2: Define services ───────────────────────────────────────────────────

// ScrapingBee upstream cost reference: 1 credit ≈ $0.029 (1000 credits/$29 tier)
// 2captcha upstream cost reference: 1 captcha ≈ $0.0005 ($0.50/1000)
// Markup target: ~15-25% over upstream per-call cost

const services = [
  {
    name: "Web Scraping (ScrapingBee)",
    description:
      "Proxy-powered web scraping via ScrapingBee. Returns the full HTML content " +
      "of any public URL. Supports optional JavaScript rendering for SPAs. " +
      "The platform custodies the upstream API key — you pay only via x402.\n\n" +
      "**Request body:**\n" +
      "```json\n" +
      '{ "url": "https://example.com", "render_js": false, "country_code": "us" }\n' +
      "```\n\n" +
      "**Response:**\n" +
      "```json\n" +
      '{ "content": "<html>...</html>", "status_code": 200 }\n' +
      "```",
    category: "scraping",
    tags: ["scraping", "web", "html", "javascript", "proxy"],
    serviceType: "api",
    pricingModel: "per_request",
    priceInCents: 4,
    endpoint: `${BASE_URL}/api/v1/platform/scrapingbee`,
    httpMethod: "POST",
    inputSchema: JSON.stringify({
      type: "object",
      required: ["url"],
      properties: {
        url: { type: "string", format: "uri", description: "Page URL to scrape" },
        render_js: { type: "boolean", default: false, description: "Execute JavaScript before returning HTML" },
        premium_proxy: { type: "boolean", default: false, description: "Use premium residential proxy" },
        country_code: { type: "string", minLength: 2, maxLength: 2, description: "ISO-3166-1 alpha-2 proxy country" },
        wait: { type: "integer", minimum: 0, maximum: 10000, description: "Extra ms to wait after page load" },
        block_resources: { type: "boolean", default: true, description: "Block images/CSS/fonts to save credits" },
      },
    }),
    outputSchema: JSON.stringify({
      type: "object",
      properties: {
        content: { type: "string", description: "Raw HTML (or JSON) content of the page" },
        status_code: { type: "integer", description: "HTTP status code returned by the target page" },
      },
    }),
    estimatedDurationSeconds: 10,
  },
  {
    name: "CAPTCHA Solver (2captcha)",
    description:
      "Human-powered CAPTCHA solving via 2captcha. Supports reCAPTCHA v2/v3, " +
      "hCaptcha, and image-based CAPTCHAs. Typical solve time: 20-60 seconds. " +
      "The platform custodies the upstream API key — you pay only via x402.\n\n" +
      "**Request body (reCAPTCHA v2 example):**\n" +
      "```json\n" +
      '{ "type": "recaptcha_v2", "sitekey": "6Le-...", "pageurl": "https://example.com" }\n' +
      "```\n\n" +
      "**Supported types:** `recaptcha_v2`, `recaptcha_v3`, `hcaptcha`, `image`\n\n" +
      "**Response:**\n" +
      "```json\n" +
      '{ "solution": "03AGdBq25...", "task_id": 12345 }\n' +
      "```",
    category: "captcha",
    tags: ["captcha", "recaptcha", "hcaptcha", "automation", "bypass"],
    serviceType: "api",
    pricingModel: "per_request",
    priceInCents: 1,
    endpoint: `${BASE_URL}/api/v1/platform/2captcha`,
    httpMethod: "POST",
    inputSchema: JSON.stringify({
      type: "object",
      required: ["type"],
      oneOf: [
        {
          properties: {
            type: { const: "recaptcha_v2" },
            sitekey: { type: "string" },
            pageurl: { type: "string", format: "uri" },
            invisible: { type: "boolean", default: false },
          },
          required: ["type", "sitekey", "pageurl"],
        },
        {
          properties: {
            type: { const: "recaptcha_v3" },
            sitekey: { type: "string" },
            pageurl: { type: "string", format: "uri" },
            action: { type: "string" },
            min_score: { type: "number", minimum: 0, maximum: 1 },
          },
          required: ["type", "sitekey", "pageurl"],
        },
        {
          properties: {
            type: { const: "hcaptcha" },
            sitekey: { type: "string" },
            pageurl: { type: "string", format: "uri" },
          },
          required: ["type", "sitekey", "pageurl"],
        },
        {
          properties: {
            type: { const: "image" },
            body: { type: "string", description: "Base64-encoded CAPTCHA image" },
          },
          required: ["type", "body"],
        },
      ],
    }),
    outputSchema: JSON.stringify({
      type: "object",
      properties: {
        solution: { description: "Solved CAPTCHA token or text" },
        task_id: { type: "integer" },
      },
    }),
    estimatedDurationSeconds: 60,
  },
];

// ── Step 3: Register each service ─────────────────────────────────────────────

for (const svc of services) {
  process.stdout.write(`\nRegistering "${svc.name}" ... `);
  const res = await apiPost(`/api/v1/agents/${agentId}/services`, svc, apiKey);
  if (res.status === 201) {
    console.log(`✓  serviceId: ${res.body.serviceId}  price: $${(svc.priceInCents / 100).toFixed(2)}/call`);
  } else {
    console.log(`✗  ${res.status} ${JSON.stringify(res.body)}`);
  }
}

console.log("\n=== Done ===");
console.log("Both services should now appear at /marketplace/services\n");
