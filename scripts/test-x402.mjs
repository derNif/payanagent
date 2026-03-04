/**
 * End-to-end x402 payment test on Base Sepolia.
 *
 * Prerequisites:
 *   1. Local dev server running: npm run dev  (with X402_NETWORK=base-sepolia in .env.local)
 *   2. Convex dev running:       npx convex dev
 *   3. Test wallet funded with Base Sepolia USDC from faucet.circle.com
 *
 * Usage:
 *   node scripts/test-x402.mjs
 */

import { x402Client, wrapFetchWithPayment } from "@x402/fetch";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import { privateKeyToAccount } from "viem/accounts";

// ── Config ──────────────────────────────────────────────────────
const BASE_URL = process.env.API_BASE_URL || "http://localhost:3002";
const CLIENT_KEY = process.env.TEST_CLIENT_KEY;
const CLIENT_API_KEY = process.env.TEST_API_KEY;

if (!CLIENT_KEY || !CLIENT_API_KEY) {
  console.error("Set TEST_CLIENT_KEY (wallet private key) and TEST_API_KEY (PayanAgent API key)");
  process.exit(1);
}

// ── Setup x402 client ───────────────────────────────────────────
const signer = privateKeyToAccount(CLIENT_KEY);
console.log("Client wallet:", signer.address);

const client = new x402Client();
registerExactEvmScheme(client, { signer });
const fetchPaid = wrapFetchWithPayment(fetch, client);

// ── Helpers ─────────────────────────────────────────────────────
async function api(path, opts = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${CLIENT_API_KEY}`,
      ...opts.headers,
    },
  });
  return res.json();
}

async function apiPaid(path, opts = {}) {
  const res = await fetchPaid(`${BASE_URL}${path}`, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${CLIENT_API_KEY}`,
      ...opts.headers,
    },
  });
  const text = await res.text();
  console.log(`  Status: ${res.status}`);
  console.log(`  X-Transaction-Id: ${res.headers.get("x-transaction-id") || "n/a"}`);
  console.log(`  X-Tx-Hash: ${res.headers.get("x-tx-hash") || "n/a"}`);
  try { return JSON.parse(text); } catch { return text; }
}

// ── Test flow ───────────────────────────────────────────────────
async function main() {
  // 1. Find a service
  console.log("\n=== Discovering services ===");
  const discover = await api("/api/v1/discover?q=security");
  const service = discover.services?.[0];
  if (!service) {
    console.error("No services found. Register one first.");
    process.exit(1);
  }
  console.log(`  Found: ${service.name} — $${(service.priceInCents / 100).toFixed(2)}/call`);

  // 2. Call the service with x402 auto-payment
  console.log("\n=== Calling service with x402 payment ===");
  const result = await apiPaid(`/api/v1/services/${service._id}/invoke`, {
    method: "POST",
    body: JSON.stringify({ repo: "github.com/test/auth-module" }),
  });
  console.log("  Result:", typeof result === "string" ? result.slice(0, 200) : JSON.stringify(result).slice(0, 200));

  console.log("\n=== Done ===");
}

main().catch((err) => {
  console.error("Test failed:", err.message || err);
  process.exit(1);
});
