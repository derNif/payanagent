// Buy an EXTERNAL ecosystem resource THROUGH PayanAgent's proxy-buy route.
// Non-custodial relay: we forward the seller's 402, you pay the seller directly,
// we record a receipt. Real Base-mainnet settlement — use a cheap resource.
// Usage:
//   API_BASE_URL=... TEST_CLIENT_KEY=0x... EXT_ID=<externalResources _id> \
//   BUY_METHOD=GET BUY_BODY='{}' node scripts/test-x402-ext.mjs
import { x402Client, wrapFetchWithPayment } from "@x402/fetch";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import { privateKeyToAccount } from "viem/accounts";

const BASE = process.env.API_BASE_URL || "http://localhost:3002";
const CLIENT_KEY = process.env.TEST_CLIENT_KEY;
const EXT_ID = process.env.EXT_ID;
const METHOD = (process.env.BUY_METHOD || "POST").toUpperCase();
if (!CLIENT_KEY || !EXT_ID) {
  console.error("Set TEST_CLIENT_KEY, EXT_ID (and optionally BUY_METHOD, BUY_BODY)");
  process.exit(1);
}

// clock-skew compensation (this machine)
const probe = await fetch("https://www.google.com", { method: "HEAD" });
const skewMs = Date.now() - new Date(probe.headers.get("date")).getTime();
const realNow = Date.now;
Date.now = () => realNow() - skewMs;

const signer = privateKeyToAccount(CLIENT_KEY);
console.log("buyer wallet:", signer.address);
const client = new x402Client();
registerExactEvmScheme(client, { signer });
const fetchPaid = wrapFetchWithPayment(fetch, client);

const url = `${BASE}/x402/${EXT_ID}`;
console.log(METHOD, url, "(routed through PayanAgent)");
const res = await fetchPaid(url, {
  method: METHOD,
  headers: METHOD === "GET" ? {} : { "Content-Type": "application/json" },
  body: METHOD === "GET" ? undefined : process.env.BUY_BODY || "{}",
});
console.log("status:", res.status);
console.log("X-Receipt-Id:", res.headers.get("x-receipt-id") || "n/a");
console.log("X-Routed-Through:", res.headers.get("x-routed-through") || "n/a");
console.log("body:", (await res.text()).slice(0, 500));
process.exit(res.ok ? 0 : 1);
