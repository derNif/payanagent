/**
 * Gasless USDC transfer via the x402 facilitator (EIP-3009).
 * Signs a transferWithAuthorization with FROM_KEY and asks the facilitator
 * to settle it — the facilitator pays gas, the sender needs zero ETH.
 *
 * Usage:
 *   FROM_KEY=0x... TO=0x... AMOUNT_CENTS=2 node scripts/x402-transfer.mjs
 */
import http from "node:http";
import { x402Client, wrapFetchWithPayment } from "@x402/fetch";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import { privateKeyToAccount } from "viem/accounts";

const FROM_KEY = process.env.FROM_KEY;
const TO = process.env.TO;
const AMOUNT_CENTS = parseInt(process.env.AMOUNT_CENTS || "0", 10);
const FACILITATOR_URL = process.env.FACILITATOR_URL || "https://facilitator.xpay.sh";
const NETWORK = "eip155:8453";
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

if (!FROM_KEY || !TO || !AMOUNT_CENTS) {
  console.error("Set FROM_KEY, TO, AMOUNT_CENTS");
  process.exit(1);
}

// Clock-skew compensation
const probe = await fetch("https://www.google.com", { method: "HEAD" });
const skewMs = Date.now() - new Date(probe.headers.get("date")).getTime();
const realNow = Date.now;
Date.now = () => realNow() - skewMs;

const signer = privateKeyToAccount(FROM_KEY);
const amount = String(AMOUNT_CENTS * 10000);
console.log(`from: ${signer.address}\nto:   ${TO}\namount: $${(AMOUNT_CENTS / 100).toFixed(2)} (${amount} base units)`);

// Synthetic x402 challenge for a plain transfer
const paymentRequired = Buffer.from(JSON.stringify({
  x402Version: 2,
  resource: { url: "https://payanagent.com/internal/reimbursement", description: "Direct USDC transfer", mimeType: "application/json" },
  accepts: [{
    scheme: "exact",
    network: NETWORK,
    amount,
    payTo: TO,
    asset: USDC,
    maxTimeoutSeconds: 60,
    extra: { name: "USD Coin", version: "2" },
  }],
  error: "Payment required.",
})).toString("base64");

// Local stub replays the challenge so the x402 client signs it for us
let signature = null;
const server = http.createServer((req, res) => {
  const sig = req.headers["payment-signature"] || req.headers["x-payment"];
  if (!sig) {
    res.writeHead(402, { "Content-Type": "application/json", "PAYMENT-REQUIRED": paymentRequired });
    res.end(JSON.stringify({ error: "Payment required" }));
  } else {
    signature = Array.isArray(sig) ? sig[0] : sig;
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end("{}");
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));

const client = new x402Client();
registerExactEvmScheme(client, { signer });
const fetchPaid = wrapFetchWithPayment(fetch, client);
await fetchPaid(`http://127.0.0.1:${server.address().port}/`, { method: "POST" });
server.close();

if (!signature) {
  console.error("Failed to produce signed payload");
  process.exit(1);
}

const payload = JSON.parse(Buffer.from(signature, "base64").toString());
const res = await fetch(`${FACILITATOR_URL}/settle`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    x402Version: payload.x402Version || 2,
    paymentPayload: payload,
    paymentRequirements: payload.accepted,
  }),
});
const data = await res.json();
console.log("settle:", res.status, JSON.stringify(data));
process.exit(data.success && data.transaction ? 0 : 1);
