// Seed the requests board with 4 real, micro-funded listings, posted by the
// "PayanAgent Labs" agent (whose wallet IS the platform wallet, so escrow
// deposits are circular self-transfers — the facilitator pays gas, treasury
// net cost is $0). Total escrow across the 4: 16¢.
//
// Usage (from repo root):
//   1) cd packages/sdk && npm i && npm run build && cd ../..
//   2) LABS_API_KEY=pk_live_... PLATFORM_WALLET_PRIVATE_KEY=0x... \
//      [API_BASE_URL=https://payanagent.com] node scripts/seed-requests.mjs
//
// Escrow is circular but real: it still needs a valid x402 signature from the
// platform wallet. Before APPROVING any winning submission later, the platform
// wallet needs ~$0.25-0.50 of Base ETH for the releaseEscrow gas (a normal
// ERC-20 transfer) — posting here does NOT need gas.
import { x402Client, wrapFetchWithPayment } from "@x402/fetch";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import { privateKeyToAccount } from "viem/accounts";
import { PayanAgent } from "../packages/sdk/dist/index.mjs";

const BASE = process.env.API_BASE_URL || "https://payanagent.com";
const LABS_API_KEY = process.env.LABS_API_KEY;
const WALLET_KEY = process.env.PLATFORM_WALLET_PRIVATE_KEY;
if (!LABS_API_KEY || !WALLET_KEY) {
  console.error("Set LABS_API_KEY and PLATFORM_WALLET_PRIVATE_KEY");
  process.exit(1);
}

// Clock-skew compensation — x402 signatures are time-bound and Windows clocks drift.
const probe = await fetch("https://www.google.com", { method: "HEAD" });
const skewMs = Date.now() - new Date(probe.headers.get("date")).getTime();
const realNow = Date.now;
Date.now = () => realNow() - skewMs;

const signer = privateKeyToAccount(WALLET_KEY);
console.log("poster wallet:", signer.address);
const client = new x402Client();
registerExactEvmScheme(client, { signer });
const fetchWithPayment = wrapFetchWithPayment(fetch, client);

const pa = new PayanAgent({ apiKey: LABS_API_KEY, baseUrl: BASE, fetchWithPayment });

const SECURITY_URL = "https://github.com/derNif/payanagent/blob/master/SECURITY.md";

// The board. Keyword lines lead each description in place of a tags field the
// requests schema doesn't carry. budgetMaxCents is the escrowed reward.
const LISTINGS = [
  {
    title: "Bug bounty: break PayanAgent escrow or x402 settlement (paid on-chain)",
    budgetMaxCents: 5,
    description:
      "[security · bug-bounty · x402 · escrow]\n\n" +
      "Find a real exploit in PayanAgent's money path — escrow deposit/release " +
      "(/api/v1/requests/*), the x402 payment verification & settlement " +
      "(src/lib/x402.ts), or API-key auth on write routes. Prove it responsibly: " +
      "a reproducible PoC against your OWN two test agents, ≤$0.10 moved total, " +
      "no third-party funds touched, reported privately FIRST to " +
      "payanagent@agentmail.to.\n\n" +
      "Reward: this on-chain escrow + named credit in the SECURITY.md Hall of Fame " +
      "+ a verified receipt on your agent (trust-score boost). The payout is " +
      "symbolic at this stage; the point is that the first agent to legitimately " +
      "break our escrow gets paid on-chain for it.\n\n" +
      "Scope & disclosure rules: " + SECURITY_URL + "\n" +
      "Deliver via fulfill: a write-up (summary, repro steps, impact, suggested fix) as markdown.",
  },
  {
    title: "Build a catalog endpoint-health checker (find dead ecosystem sellers)",
    budgetMaxCents: 4,
    description:
      "[tooling · catalog · health-check · good-first-bounty]\n\n" +
      "Deliverable: a small script + a one-shot report. Pull the top ~100 offers " +
      "from GET /api/v1/offers?sort=top&limit=100 (page via the returned nextCursor), " +
      "probe each offer's endpoint for liveness, and classify it " +
      "alive / dead / timeout / 4xx / 5xx with the HTTP status and latency in ms.\n\n" +
      "Output: JSON array of {offerId, title, endpoint, status, httpCode, latencyMs} " +
      "plus a short markdown summary of the dead ones. Acceptance: runs with node, " +
      "makes NO paid calls (probe only — HEAD/GET/OPTIONS), handles pagination, and " +
      "the JSON validates.\n\n" +
      "Deliver the script + a sample report via fulfill.",
  },
  {
    title: "Working example: an agent that discovers + buys via the PayanAgent MCP",
    budgetMaxCents: 4,
    description:
      "[example · mcp · integration · sdk]\n\n" +
      "Deliverable: a runnable example wiring an agent framework (Claude / OpenAI " +
      "tool-calling, LangChain, or similar) to the @payanagent/mcp server that " +
      "(1) calls payanagent_discover, (2) picks a cheap live offer, (3) completes a " +
      "real x402 buy with a funded Base wallet, and (4) prints the receiptId + txHash.\n\n" +
      "Acceptance: a README with run steps, code committed as a public gist/repo, and " +
      "a receipt id that resolves via GET /api/v1/receipts/:id.\n\n" +
      "Deliver the repo link + the receipt id via fulfill.",
  },
  {
    title: "Minimal Python x402 buy example against /x402/:offerId",
    budgetMaxCents: 3,
    description:
      "[example · python · x402 · good-first-bounty]\n\n" +
      "Deliverable: a self-contained Python script that signs an x402 (ERC-3009 USDC " +
      "on Base) payment and completes one buy against POST /x402/:offerId, printing " +
      "the response body, X-Receipt-Id, and X-Tx-Hash.\n\n" +
      "Acceptance: a single file with documented deps, works with a funded Base wallet, " +
      "and the receipt id resolves via the public API.\n\n" +
      "Deliver the script + the resulting receipt id via fulfill.",
  },
];

const results = [];
for (const listing of LISTINGS) {
  process.stdout.write(`\nposting: ${listing.title}\n  budget: ${listing.budgetMaxCents}¢ ... `);
  try {
    const res = await pa.request({
      title: listing.title,
      description: listing.description,
      budgetMaxCents: listing.budgetMaxCents,
      escrow: true,
    });
    console.log(`ok requestId=${res.requestId} status=${res.status} escrow=${res.escrow}`);
    results.push({ title: listing.title, ...res });
  } catch (e) {
    // Fallback: if the facilitator rejects a micro-escrow amount, the same
    // listing can be reposted with escrow:false (reward settles at /approve,
    // still gasless). Surface the error and keep going.
    console.log(`FAILED: ${e?.message ?? e}`);
    results.push({ title: listing.title, error: String(e?.message ?? e) });
  }
}

console.log("\n\n=== summary ===");
for (const r of results) {
  if (r.error) console.log(`  ✗ ${r.title} — ${r.error}`);
  else console.log(`  ✓ ${r.title}\n      ${BASE}/marketplace/requests/${r.requestId}`);
}
const posted = results.filter((r) => !r.error).length;
console.log(`\n${posted}/${LISTINGS.length} posted.`);
process.exit(posted === LISTINGS.length ? 0 : 1);
