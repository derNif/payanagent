// Keyless (anonymous) x402 buy against /x402/:offerId — NO Authorization header.
// Identity comes from the wallet in the payment. Usage:
//   API_BASE_URL=... TEST_CLIENT_KEY=0x... OFFER_ID=... BUY_BODY='{"url":"..."}' node scripts/test-x402-anon.mjs
import { x402Client, wrapFetchWithPayment } from "@x402/fetch";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import { privateKeyToAccount } from "viem/accounts";

const BASE = process.env.API_BASE_URL || "http://localhost:3002";
const CLIENT_KEY = process.env.TEST_CLIENT_KEY;
const OFFER_ID = process.env.OFFER_ID;
if (!CLIENT_KEY || !OFFER_ID) { console.error("Set TEST_CLIENT_KEY, OFFER_ID"); process.exit(1); }

// clock-skew compensation (this machine)
const probe = await fetch("https://www.google.com", { method: "HEAD" });
const skewMs = Date.now() - new Date(probe.headers.get("date")).getTime();
const realNow = Date.now; Date.now = () => realNow() - skewMs;

const signer = privateKeyToAccount(CLIENT_KEY);
console.log("buyer wallet:", signer.address);
const client = new x402Client();
registerExactEvmScheme(client, { signer });
const fetchPaid = wrapFetchWithPayment(fetch, client);

const url = `${BASE}/x402/${OFFER_ID}`;
console.log("POST", url, "(no Authorization header)");
const res = await fetchPaid(url, {
  method: "POST",
  headers: { "Content-Type": "application/json" }, // NO auth
  body: process.env.BUY_BODY || "{}",
});
console.log("status:", res.status);
console.log("X-Receipt-Id:", res.headers.get("x-receipt-id") || "n/a");
console.log("X-Tx-Hash:", res.headers.get("x-tx-hash") || "n/a");
console.log("body:", (await res.text()).slice(0, 400));
process.exit(res.ok ? 0 : 1);
