/**
 * Probe the x402 facilitator directly: capture the exact PAYMENT-SIGNATURE the
 * client library produces for a real prod 402 challenge, then call the
 * facilitator's /verify and /settle and print RAW responses.
 *
 * Usage:
 *   TEST_CLIENT_KEY=0x... OFFER_ID=... [FACILITATOR_URL=...] [DO_SETTLE=1] node scripts/probe-facilitator.mjs
 */
import http from "node:http";
import { x402Client, wrapFetchWithPayment } from "@x402/fetch";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import { privateKeyToAccount } from "viem/accounts";

const BASE_URL = process.env.API_BASE_URL || "https://payanagent.com";
const CLIENT_KEY = process.env.TEST_CLIENT_KEY;
const OFFER_ID = process.env.OFFER_ID;
const FACILITATOR_URL = process.env.FACILITATOR_URL || "https://facilitator.xpay.sh";
const DO_SETTLE = process.env.DO_SETTLE === "1";

if (!CLIENT_KEY || !OFFER_ID) {
  console.error("Set TEST_CLIENT_KEY, OFFER_ID");
  process.exit(1);
}

// Clock-skew compensation (same as test-buy-v02.mjs)
const probe = await fetch("https://www.google.com", { method: "HEAD" });
const skewMs = Date.now() - new Date(probe.headers.get("date")).getTime();
console.log(`clock skew: ${(skewMs / 1000).toFixed(0)}s — compensating`);
const realNow = Date.now;
Date.now = () => realNow() - skewMs;

// 1. Get the real 402 challenge from prod
const challengeRes = await fetch(`${BASE_URL}/api/v1/offers/${OFFER_ID}/buy`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    ...(process.env.TEST_API_KEY ? { Authorization: `Bearer ${process.env.TEST_API_KEY}` } : {}),
  },
  body: "{}",
});
const paymentRequired = challengeRes.headers.get("payment-required");
if (challengeRes.status !== 402 || !paymentRequired) {
  console.error("Expected 402 with PAYMENT-REQUIRED header, got", challengeRes.status);
  process.exit(1);
}
console.log("challenge:", JSON.stringify(JSON.parse(Buffer.from(paymentRequired, "base64").toString()), null, 2));

// 2. Stand up a local stub that replays the challenge, then captures the
//    signed PAYMENT-SIGNATURE header the x402 client produces.
let capturedSignature = null;
const server = http.createServer((req, res) => {
  const sig = req.headers["payment-signature"] || req.headers["x-payment"];
  if (!sig) {
    res.writeHead(402, {
      "Content-Type": "application/json",
      "PAYMENT-REQUIRED": paymentRequired,
    });
    res.end(JSON.stringify({ error: "Payment required" }));
  } else {
    capturedSignature = Array.isArray(sig) ? sig[0] : sig;
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ captured: true }));
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const port = server.address().port;

const signer = privateKeyToAccount(CLIENT_KEY);
console.log("buyer wallet:", signer.address);
const client = new x402Client();
registerExactEvmScheme(client, { signer });
const fetchPaid = wrapFetchWithPayment(fetch, client);
await fetchPaid(`http://127.0.0.1:${port}/`, { method: "POST" });
server.close();

if (!capturedSignature) {
  console.error("Failed to capture payment signature");
  process.exit(1);
}
const payload = JSON.parse(Buffer.from(capturedSignature, "base64").toString());
console.log("\nsigned payload:", JSON.stringify(payload, null, 2));

// 3. Call the facilitator directly
const body = JSON.stringify({
  x402Version: payload.x402Version || 2,
  paymentPayload: payload,
  paymentRequirements: payload.accepted,
});

console.log(`\n--- ${FACILITATOR_URL}/verify ---`);
const v = await fetch(`${FACILITATOR_URL}/verify`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body,
});
console.log("status:", v.status);
console.log("body:", await v.text());

if (DO_SETTLE) {
  console.log(`\n--- ${FACILITATOR_URL}/settle ---`);
  const s = await fetch(`${FACILITATOR_URL}/settle`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
  console.log("status:", s.status);
  console.log("body:", await s.text());
} else {
  console.log("\n(skipping /settle — set DO_SETTLE=1 to settle for real)");
}
