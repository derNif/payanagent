import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "../..");

function rootUrl(rel: string) {
  return pathToFileURL(resolve(root, rel)).href;
}

const load = () => import(rootUrl("src/lib/format.ts"));

describe("usd", () => {
  it("always shows at least two decimals and groups thousands", async () => {
    const { usd } = await load();

    assert.equal(usd(0), "$0.00");
    assert.equal(usd(1), "$1.00");
    assert.equal(usd(1234.5), "$1,234.50");
  });

  it("keeps sub-cent precision up to six decimals instead of rounding to $0.00", async () => {
    const { usd } = await load();

    assert.equal(usd(0.001), "$0.001");
    assert.equal(usd(0.000001), "$0.000001");
    assert.equal(usd(0.0012345), "$0.001235"); // 6-decimal USDC precision
  });

  it("falls back to $0.00 for non-finite values", async () => {
    const { usd } = await load();

    assert.equal(usd(NaN), "$0.00");
    assert.equal(usd(Infinity), "$0.00");
  });
});

describe("usdAmount", () => {
  it("uses cents when no micro-USD amount is given", async () => {
    const { usdAmount } = await load();

    assert.equal(usdAmount(150), "$1.50");
    assert.equal(usdAmount(150, null), "$1.50");
    assert.equal(usdAmount(150, undefined), "$1.50");
  });

  it("prefers the exact micro-USD amount, including sub-cent and zero", async () => {
    const { usdAmount } = await load();

    assert.equal(usdAmount(0, 1_000), "$0.001");
    assert.equal(usdAmount(150, 1_500_000), "$1.50");
    assert.equal(usdAmount(1, 0), "$0.00");
  });
});

describe("offerPrice", () => {
  it("prefers amountRaw (USDC base units) over rounded priceCents", async () => {
    const { offerPrice } = await load();

    assert.equal(offerPrice({ amountRaw: "1000", priceCents: 0 }), "$0.001");
    assert.equal(offerPrice({ amountRaw: "2500000", priceCents: 250 }), "$2.50");
  });

  it("falls back to priceCents when amountRaw is absent", async () => {
    const { offerPrice } = await load();

    assert.equal(offerPrice({ priceCents: 250 }), "$2.50");
    assert.equal(offerPrice({ amountRaw: null, priceCents: 250 }), "$2.50");
  });

  it("reports non-positive and unparseable prices as free", async () => {
    const { offerPrice } = await load();

    assert.equal(offerPrice({ priceCents: 0 }), "free");
    assert.equal(offerPrice({ priceCents: -100 }), "free");
    assert.equal(offerPrice({ amountRaw: "0", priceCents: 500 }), "free");
    assert.equal(offerPrice({ amountRaw: "not-a-number", priceCents: 500 }), "free");
  });
});
