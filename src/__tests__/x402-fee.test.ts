import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "../..");

function rootUrl(rel: string) {
  return pathToFileURL(resolve(root, rel)).href;
}

const PLATFORM_WALLET = "0x1111111111111111111111111111111111111111";
const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

// The fee module only needs the network id and the settle call from x402.ts;
// stubbing them keeps the signing/RPC stack out of these tests.
let settleResult: { success: boolean; txHash?: string; error?: string } = { success: true };
let settleCalls = 0;
mock.module("@/lib/x402", {
  namedExports: {
    getNetworkId: () => "eip155:8453",
    settlePayment: async () => {
      settleCalls++;
      return settleResult;
    },
  },
});

// FEE_BPS / PLATFORM_WALLET_ADDRESS are read once at module load, so each fee
// configuration needs its own module instance — hence the cache-busting query.
async function loadWithFee(bps: string, wallet = PLATFORM_WALLET) {
  process.env.PAYANAGENT_FEE_BPS = bps;
  process.env.PLATFORM_WALLET_ADDRESS = wallet;
  return import(`${rootUrl("src/lib/x402-fee.ts")}?bps=${bps}&wallet=${wallet}`);
}

function feeRequest(headers: Record<string, string>) {
  return new Request("https://payanagent.com/x402/offer1", { method: "POST", headers });
}

describe("fee disabled (the default)", () => {
  it("is a no-op at 0 bps", async () => {
    const fee = await loadWithFee("0");

    assert.equal(fee.FEE_BPS, 0);
    assert.equal(fee.feeEnabled(), false);
    assert.equal(fee.feeMicroUsd(1_000_000), 0);
    assert.equal(fee.feeAdvertHeader(1_000_000), null);

    const headers = new Headers();
    fee.attachFeeAdvert(headers, 1_000_000);
    assert.equal(headers.get("x-payanagent-fee"), null);

    settleCalls = 0;
    assert.equal(
      await fee.collectFee(feeRequest({ "x-payanagent-fee-payment": "signed" })),
      null
    );
    assert.equal(settleCalls, 0, "must not settle anything while the fee is off");
  });

  it("stays off when no platform wallet is configured", async () => {
    const fee = await loadWithFee("250", "");

    assert.equal(fee.feeEnabled(), false);
    assert.equal(fee.feeMicroUsd(1_000_000), 0);
  });
});

describe("fee enabled", () => {
  it("takes the configured bps of the price, floored", async () => {
    const fee = await loadWithFee("250"); // 2.5%

    assert.equal(fee.feeEnabled(), true);
    assert.equal(fee.feeMicroUsd(1_000_000), 25_000);
    assert.equal(fee.feeMicroUsd(1_000), 25);
    assert.equal(fee.feeMicroUsd(39), 0); // rounds down below 1 base unit
  });

  it("advertises the fee as a second, buyer-signed payment to the platform", async () => {
    const fee = await loadWithFee("500");

    const advert = JSON.parse(fee.feeAdvertHeader(2_000_000)!);
    assert.equal(advert.payTo, PLATFORM_WALLET);
    assert.equal(advert.amount, "100000");
    assert.equal(advert.asset, USDC_BASE);
    assert.equal(advert.network, "eip155:8453");
    assert.equal(advert.bps, 500);

    const headers = new Headers();
    fee.attachFeeAdvert(headers, 2_000_000);
    assert.deepEqual(JSON.parse(headers.get("x-payanagent-fee")!), advert);
  });

  it("omits the advert when the computed fee rounds to zero", async () => {
    const fee = await loadWithFee("100");

    assert.equal(fee.feeAdvertHeader(0), null);

    const headers = new Headers();
    fee.attachFeeAdvert(headers, 0);
    assert.equal(headers.get("x-payanagent-fee"), null);
  });
});

describe("collectFee", () => {
  it("settles the fee leg and returns its tx hash", async () => {
    const fee = await loadWithFee("250");

    settleResult = { success: true, txHash: "0xfee" };
    assert.equal(
      await fee.collectFee(feeRequest({ "x-payanagent-fee-payment": "signed" })),
      "0xfee"
    );
  });

  it("returns null when a standard x402 client sends no fee payment", async () => {
    const fee = await loadWithFee("250");

    settleCalls = 0;
    assert.equal(await fee.collectFee(feeRequest({})), null);
    assert.equal(settleCalls, 0);
  });

  it("returns null when the fee leg fails to settle", async () => {
    const fee = await loadWithFee("250");

    settleResult = { success: false, error: "nonce_reused" };
    assert.equal(
      await fee.collectFee(feeRequest({ "x-payanagent-fee-payment": "signed" })),
      null
    );
  });
});
