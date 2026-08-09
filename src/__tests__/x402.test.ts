import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "../..");

function rootUrl(rel: string) {
  return pathToFileURL(resolve(root, rel)).href;
}

// x402.ts reads these at module load, so they must be set before the import.
const PLATFORM_WALLET = "0x1111111111111111111111111111111111111111";
const SELLER_WALLET = "0x2222222222222222222222222222222222222222";
const BASE_MAINNET = "eip155:8453";
const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

process.env.PLATFORM_WALLET_ADDRESS = PLATFORM_WALLET;
process.env.X402_NETWORK = "base";

const load = () => import(rootUrl("src/lib/x402.ts"));

function encode(payload: unknown): string {
  return Buffer.from(JSON.stringify(payload)).toString("base64");
}

/** A signed-payment header whose `accepted` terms match a $1.00 buy. */
function paymentHeader(overrides: Record<string, unknown> = {}) {
  return encode({
    x402Version: 2,
    accepted: {
      scheme: "exact",
      network: BASE_MAINNET,
      amount: "10000000",
      payTo: SELLER_WALLET,
      asset: USDC_BASE,
      ...overrides,
    },
  });
}

describe("centsToUsdcBaseUnits", () => {
  it("converts cents to 6-decimal USDC base units", async () => {
    const { centsToUsdcBaseUnits } = await load();

    assert.equal(centsToUsdcBaseUnits(1), "10000");
    assert.equal(centsToUsdcBaseUnits(100), "1000000");
    assert.equal(centsToUsdcBaseUnits(0), "0");
  });
});

describe("network helpers", () => {
  it("maps the configured network to its CAIP-2 id", async () => {
    const { getNetwork, getNetworkId, getFacilitatorUrl } = await load();

    assert.equal(getNetwork(), "base");
    assert.equal(getNetworkId(), BASE_MAINNET);
    assert.equal(getFacilitatorUrl(), "https://facilitator.xpay.sh");
  });
});

describe("extractBuyerWallet", () => {
  it("reads the EIP-3009 authorization `from` address", async () => {
    const { extractBuyerWallet } = await load();

    const header = encode({
      payload: { authorization: { from: SELLER_WALLET } },
    });
    assert.equal(extractBuyerWallet(header), SELLER_WALLET);
  });

  it("returns null for garbage, missing or malformed addresses", async () => {
    const { extractBuyerWallet } = await load();

    assert.equal(extractBuyerWallet("not-base64-json"), null);
    assert.equal(extractBuyerWallet(encode({ payload: {} })), null);
    assert.equal(
      extractBuyerWallet(encode({ payload: { authorization: { from: "0xdeadbeef" } } })),
      null
    );
    assert.equal(
      extractBuyerWallet(encode({ payload: { authorization: { from: 42 } } })),
      null
    );
  });
});

describe("buildPaymentRequiredResponse", () => {
  it("returns a 402 carrying base64 x402 v2 terms for the seller", async () => {
    const { buildPaymentRequiredResponse } = await load();

    const res = buildPaymentRequiredResponse(
      250,
      "https://payanagent.com/x402/offer1",
      "Web search",
      SELLER_WALLET
    );

    assert.equal(res.status, 402);
    assert.deepEqual(await res.json(), { error: "Payment required", priceUsd: 2.5 });

    const terms = JSON.parse(
      Buffer.from(res.headers.get("PAYMENT-REQUIRED")!, "base64").toString("utf-8")
    );
    assert.equal(terms.x402Version, 2);
    assert.equal(terms.resource.url, "https://payanagent.com/x402/offer1");
    assert.deepEqual(terms.accepts, [
      {
        scheme: "exact",
        network: BASE_MAINNET,
        amount: "2500000",
        payTo: SELLER_WALLET,
        asset: USDC_BASE,
        maxTimeoutSeconds: 60,
        // Must match the on-chain USDC EIP-712 domain or the signature reverts.
        extra: { name: "USD Coin", version: "2" },
      },
    ]);
  });

  it("defaults payTo to the platform wallet (escrow flows)", async () => {
    const { buildPaymentRequiredResponse } = await load();

    const res = buildPaymentRequiredResponse(100, "https://payanagent.com/x402/o", "d");
    const terms = JSON.parse(
      Buffer.from(res.headers.get("PAYMENT-REQUIRED")!, "base64").toString("utf-8")
    );
    assert.equal(terms.accepts[0].payTo, PLATFORM_WALLET);
  });
});

describe("verifyPaymentIntegrity", () => {
  it("accepts terms binding the exact price, recipient, network and USDC asset", async () => {
    const { verifyPaymentIntegrity } = await load();

    assert.deepEqual(verifyPaymentIntegrity(paymentHeader(), 1000, SELLER_WALLET), {
      valid: true,
    });
  });

  it("compares wallet addresses case-insensitively", async () => {
    const { verifyPaymentIntegrity } = await load();

    const result = verifyPaymentIntegrity(
      paymentHeader({ payTo: SELLER_WALLET.toUpperCase().replace("0X", "0x") }),
      1000,
      SELLER_WALLET
    );
    assert.equal(result.valid, true);
  });

  it("defaults the expected recipient to the platform wallet", async () => {
    const { verifyPaymentIntegrity } = await load();

    assert.equal(
      verifyPaymentIntegrity(paymentHeader({ payTo: PLATFORM_WALLET }), 1000).valid,
      true
    );
    assert.equal(verifyPaymentIntegrity(paymentHeader(), 1000).valid, false);
  });

  it("rejects an undecodable header or missing accepted terms", async () => {
    const { verifyPaymentIntegrity } = await load();

    assert.deepEqual(verifyPaymentIntegrity("%%%", 1000, SELLER_WALLET), {
      valid: false,
      error: "Cannot decode payment signature",
    });
    assert.deepEqual(verifyPaymentIntegrity(encode({ x402Version: 2 }), 1000, SELLER_WALLET), {
      valid: false,
      error: "Missing accepted requirements in payment",
    });
  });

  it("fails closed when a binding field is omitted", async () => {
    const { verifyPaymentIntegrity } = await load();

    const cases: [string, RegExp][] = [
      ["payTo", /missing payTo/],
      ["amount", /missing amount/],
      ["network", /missing network/],
      ["asset", /missing asset/],
    ];
    for (const [field, expected] of cases) {
      const result = verifyPaymentIntegrity(
        paymentHeader({ [field]: undefined }),
        1000,
        SELLER_WALLET
      );
      assert.equal(result.valid, false, field);
      assert.match(result.error!, expected);
    }
  });

  it("rejects a mismatched recipient, amount, network or asset", async () => {
    const { verifyPaymentIntegrity } = await load();

    assert.match(
      verifyPaymentIntegrity(paymentHeader(), 1000, PLATFORM_WALLET).error!,
      /recipient does not match/
    );
    assert.match(
      verifyPaymentIntegrity(paymentHeader(), 999, SELLER_WALLET).error!,
      /amount mismatch: expected 9990000, got 10000000/
    );
    assert.match(
      verifyPaymentIntegrity(
        paymentHeader({ network: "eip155:84532" }),
        1000,
        SELLER_WALLET
      ).error!,
      /Network mismatch/
    );
    assert.match(
      verifyPaymentIntegrity(
        // A non-USDC token with matching numbers must not pass.
        paymentHeader({ asset: "0x4200000000000000000000000000000000000006" }),
        1000,
        SELLER_WALLET
      ).error!,
      /not USDC on the expected network/
    );
  });
});

describe("verifyPayment / settlePayment — facilitator responses", () => {
  const realFetch = globalThis.fetch;

  function stubFetch(body: unknown, init?: ResponseInit) {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify(body), init)) as typeof globalThis.fetch;
  }

  it("verifies a payment the facilitator accepts and surfaces its rejections", async (t) => {
    const { verifyPayment } = await load();
    t.after(() => {
      globalThis.fetch = realFetch;
    });

    stubFetch({ isValid: true, transaction: "0xabc" });
    assert.deepEqual(await verifyPayment(paymentHeader(), ""), {
      valid: true,
      txHash: "0xabc",
    });

    stubFetch({ isValid: false, invalidReason: "insufficient_funds" });
    assert.deepEqual(await verifyPayment(paymentHeader(), ""), {
      valid: false,
      error: "insufficient_funds",
    });

    stubFetch({ invalidMessage: "bad signature" }, { status: 400 });
    assert.deepEqual(await verifyPayment(paymentHeader(), ""), {
      valid: false,
      error: "bad signature",
    });
  });

  it("treats HTTP 200 without a transaction as a failed settlement", async (t) => {
    const { settlePayment } = await load();
    t.after(() => {
      globalThis.fetch = realFetch;
    });

    stubFetch({ success: true, transaction: "0xdef" });
    assert.deepEqual(await settlePayment(paymentHeader(), ""), {
      success: true,
      txHash: "0xdef",
    });

    stubFetch({ success: false, errorReason: "nonce_reused" });
    assert.deepEqual(await settlePayment(paymentHeader(), ""), {
      success: false,
      error: "nonce_reused",
    });

    stubFetch({ success: true });
    assert.deepEqual(await settlePayment(paymentHeader(), ""), {
      success: false,
      error: "Settlement failed (no transaction)",
    });
  });

  it("reports an unreachable facilitator instead of throwing", async (t) => {
    const { settlePayment } = await load();
    t.after(() => {
      globalThis.fetch = realFetch;
    });

    globalThis.fetch = (async () => {
      throw new Error("connect ECONNREFUSED");
    }) as typeof globalThis.fetch;

    assert.deepEqual(await settlePayment(paymentHeader(), ""), {
      success: false,
      error: "connect ECONNREFUSED",
    });
  });

  it("rejects payloads it cannot decode without calling the facilitator", async () => {
    const { verifyPayment, settlePayment } = await load();

    globalThis.fetch = (async () => {
      throw new Error("facilitator must not be called");
    }) as typeof globalThis.fetch;
    try {
      assert.deepEqual(await verifyPayment("%%%", ""), {
        valid: false,
        error: "Invalid payment signature header",
      });
      assert.deepEqual(await settlePayment(encode({ x402Version: 2 }), ""), {
        success: false,
        error: "Missing accepted payment requirements in payload",
      });
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});

describe("releaseEscrow", () => {
  it("fails closed on a malformed recipient or amount before signing anything", async () => {
    const { releaseEscrow } = await load();

    process.env.PLATFORM_WALLET_PRIVATE_KEY = `0x${"a".repeat(64)}`;
    try {
      assert.deepEqual(await releaseEscrow("0xdeadbeef", 100), {
        success: false,
        error: "Invalid recipient address",
      });
      assert.deepEqual(await releaseEscrow(SELLER_WALLET, 0), {
        success: false,
        error: "Invalid release amount",
      });
      assert.deepEqual(await releaseEscrow(SELLER_WALLET, 1.5), {
        success: false,
        error: "Invalid release amount",
      });
    } finally {
      delete process.env.PLATFORM_WALLET_PRIVATE_KEY;
    }
  });

  it("reports an unconfigured or malformed platform key", async () => {
    const { releaseEscrow } = await load();

    delete process.env.PLATFORM_WALLET_PRIVATE_KEY;
    assert.deepEqual(await releaseEscrow(SELLER_WALLET, 100), {
      success: false,
      error: "PLATFORM_WALLET_PRIVATE_KEY not configured",
    });

    process.env.PLATFORM_WALLET_PRIVATE_KEY = "nope";
    try {
      assert.deepEqual(await releaseEscrow(SELLER_WALLET, 100), {
        success: false,
        error: "Invalid private key format",
      });
    } finally {
      delete process.env.PLATFORM_WALLET_PRIVATE_KEY;
    }
  });
});
