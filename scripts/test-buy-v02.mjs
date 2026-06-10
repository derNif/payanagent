/**
 * v0.2 settlement test: real x402 buy on Base Sepolia via POST /api/v1/offers/:id/buy.
 *
 * Usage:
 *   TEST_CLIENT_KEY=0x... TEST_API_KEY=pk_test_... OFFER_ID=... node scripts/test-buy-v02.mjs
 */
import { x402Client, wrapFetchWithPayment } from "@x402/fetch";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import { privateKeyToAccount } from "viem/accounts";

const BASE_URL = process.env.API_BASE_URL || "http://localhost:3000";
const CLIENT_KEY = process.env.TEST_CLIENT_KEY;
const API_KEY = process.env.TEST_API_KEY;
const OFFER_ID = process.env.OFFER_ID;

if (!CLIENT_KEY || !API_KEY || !OFFER_ID) {
  console.error("Set TEST_CLIENT_KEY, TEST_API_KEY, OFFER_ID");
  process.exit(1);
}

// Compensate for local clock skew (this machine runs ahead of real time, which
// makes signed x402 authorizations "not valid yet" from the facilitator's view).
// Measure skew against a reliable Date header and shift Date.now() accordingly.
const probe = await fetch("https://www.google.com", { method: "HEAD" });
const remoteMs = new Date(probe.headers.get("date")).getTime();
const skewMs = Date.now() - remoteMs;
console.log(`clock skew vs remote: ${(skewMs / 1000).toFixed(0)}s — compensating`);
const realNow = Date.now;
Date.now = () => realNow() - skewMs;

const signer = privateKeyToAccount(CLIENT_KEY);
console.log("buyer wallet:", signer.address);

const client = new x402Client();
registerExactEvmScheme(client, { signer });
const fetchPaid = wrapFetchWithPayment(fetch, client);

console.log(`\nPOST ${BASE_URL}/api/v1/offers/${OFFER_ID}/buy`);
const res = await fetchPaid(`${BASE_URL}/api/v1/offers/${OFFER_ID}/buy`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${API_KEY}`,
  },
  body: JSON.stringify({ hello: "first real settlement", ts: Date.now() }),
});

console.log("status:", res.status);
console.log("X-Receipt-Id:", res.headers.get("x-receipt-id") || "n/a");
console.log("X-Tx-Hash:", res.headers.get("x-tx-hash") || "n/a");
const text = await res.text();
console.log("body (first 400):", text.slice(0, 400));
process.exit(res.ok ? 0 : 1);
