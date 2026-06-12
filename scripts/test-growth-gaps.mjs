// One-shot verification for the growth-and-gaps branch against local dev.
// 1. discoverySource: stored on registration, stripped from public reads.
// 2. Non-escrow approve: returns an x402 challenge with payTo = provider wallet.
// Usage: node scripts/test-growth-gaps.mjs [baseUrl]

const BASE = process.argv[2] || "http://localhost:3002";

const j = (r) => r.json();
const post = (path, body, key) =>
  fetch(`${BASE}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(key ? { Authorization: `Bearer ${key}` } : {}),
    },
    body: JSON.stringify(body),
  });

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

const suffix = Math.floor(Math.random() * 1e6);
const wallet = () =>
  "0x" + [...crypto.getRandomValues(new Uint8Array(20))].map((b) => b.toString(16).padStart(2, "0")).join("");

// --- 1. discoverySource ---
const buyerWallet = wallet();
const reg = await post("/api/v1/agents", {
  name: `gg-buyer-${suffix}`,
  description: "test buyer for growth-gaps verification",
  walletAddress: buyerWallet,
  providerType: "agent",
  discoverySource: "test: found via verification script",
}).then(j);
check("register with discoverySource", !!reg.agentId && !!reg.apiKey, reg.error);

const pub = await fetch(`${BASE}/api/v1/agents/${reg.agentId}`).then(j);
const pubStr = JSON.stringify(pub);
check(
  "public profile strips discoverySource",
  !pubStr.includes("discoverySource") && !pubStr.includes("verification script"),
);
check("public profile strips ownerEmail key", !pubStr.includes("ownerEmail"));

const dir = await fetch(`${BASE}/api/v1/agents`).then(j);
check(
  "public directory strips discoverySource",
  !JSON.stringify(dir).includes("discoverySource"),
);

// --- 2. non-escrow approve -> x402 challenge payTo provider ---
const providerWallet = wallet();
const reg2 = await post("/api/v1/agents", {
  name: `gg-provider-${suffix}`,
  description: "test provider for growth-gaps verification",
  walletAddress: providerWallet,
  providerType: "agent",
}).then(j);
check("register provider", !!reg2.agentId, reg2.error);

const reqRes = await post(
  "/api/v1/requests",
  {
    title: "gg non-escrow direct hire",
    description: "verification request, never settled",
    budgetMaxCents: 25,
    escrow: false,
    providerId: reg2.agentId,
    agreedPriceCents: 25,
  },
  reg.apiKey,
).then(j);
check("create non-escrow direct-hire request", !!reqRes.requestId, reqRes.error);

const ful = await post(
  `/api/v1/requests/${reqRes.requestId}/fulfill`,
  { outputPayload: "done" },
  reg2.apiKey,
).then(j);
check("provider fulfills", ful.ok === true || ful.status === "fulfilled", ful.error);

const approveRes = await post(`/api/v1/requests/${reqRes.requestId}/approve`, {}, reg.apiKey);
check("approve without payment returns 402", approveRes.status === 402, `got ${approveRes.status}`);
// The x402 challenge is the base64-encoded PAYMENT-REQUIRED header.
const prHeader = approveRes.headers.get("payment-required") || "";
const challenge = prHeader
  ? JSON.parse(Buffer.from(prHeader, "base64").toString("utf8"))
  : {};
const accepts = challenge.accepts?.[0] ?? {};
check(
  "challenge payTo = provider wallet",
  (accepts.payTo || "").toLowerCase() === providerWallet.toLowerCase(),
  `payTo=${accepts.payTo}`,
);
check(
  "challenge amount = agreedPriceCents (25c -> 250000 base units)",
  String(accepts.amount) === "250000",
  `amount=${accepts.amount}`,
);

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
