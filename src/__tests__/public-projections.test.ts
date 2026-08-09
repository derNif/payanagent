import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "../..");

function rootUrl(rel: string) {
  return pathToFileURL(resolve(root, rel)).href;
}

describe("public service projections", () => {
  it("redacts credential-like query parameters from public endpoints", async () => {
    const { toPublicService } = await import(rootUrl("src/lib/public-projections.ts"));

    const service = toPublicService({
      name: "Paid endpoint",
      endpoint: "https://example.com/api/run?token=abc123abc123abc123abc123&surface=demo",
    });

    assert.equal(
      service.endpoint,
      "https://example.com/api/run?token=REDACTED&surface=demo"
    );
  });

  it("redacts embedded URL credentials", async () => {
    const { toPublicService } = await import(rootUrl("src/lib/public-projections.ts"));

    const service = toPublicService({
      endpoint: "https://user:pass@example.com/api/run",
    });

    assert.equal(service.endpoint, "https://REDACTED:REDACTED@example.com/api/run");
  });

  it("redacts secret-looking values under non-credential parameter names", async () => {
    const { toPublicService } = await import(rootUrl("src/lib/public-projections.ts"));

    const service = toPublicService({
      endpoint: "https://example.com/run?tenant=acme1234567890abcdef1234&page=2",
    });

    assert.equal(service.endpoint, "https://example.com/run?tenant=REDACTED&page=2");
  });

  it("passes through endpoints it cannot parse, and absent endpoints", async () => {
    const { toPublicService } = await import(rootUrl("src/lib/public-projections.ts"));

    assert.equal(toPublicService({ endpoint: "not a url" }).endpoint, "not a url");
    assert.equal(toPublicService({ name: "no endpoint" }).endpoint, undefined);
  });
});

describe("public agent projections", () => {
  it("strips owner PII and discovery provenance", async () => {
    const { toPublicAgent } = await import(rootUrl("src/lib/public-projections.ts"));

    const agent = toPublicAgent({
      _id: "agent1",
      name: "Searcher",
      ownerEmail: "owner@example.com",
      discoverySource: "crawler:x402-index",
    });

    assert.deepEqual(agent, { _id: "agent1", name: "Searcher" });
  });
});

describe("public offer projections", () => {
  it("strips fileUrl, internalHandler and relay provenance", async () => {
    const { toPublicOffer } = await import(rootUrl("src/lib/public-projections.ts"));

    const offer = toPublicOffer({
      _id: "offer1",
      title: "Web search",
      priceCents: 100,
      fileUrl: "https://cdn.example.com/private.zip",
      internalHandler: "labs:search",
      externalUrl: "https://gated.example.com/run",
      source: "x402-index",
    });

    assert.deepEqual(Object.keys(offer).sort(), [
      "_id",
      "endpoint",
      "priceCents",
      "priceUsd",
      "title",
    ]);
  });

  it("exposes an exact, sub-cent-aware priceUsd", async () => {
    const { toPublicOffer } = await import(rootUrl("src/lib/public-projections.ts"));

    assert.equal(toPublicOffer({ priceCents: 250 }).priceUsd, 2.5);
    assert.equal(toPublicOffer({ priceCents: 0, amountRaw: "1000" }).priceUsd, 0.001);
    assert.equal(toPublicOffer({}).priceUsd, 0);
  });

  it("keeps delivery-quality fields and redacts the endpoint", async () => {
    const { toPublicOffer } = await import(rootUrl("src/lib/public-projections.ts"));

    const offer = toPublicOffer({
      priceCents: 100,
      paidAttempts: 12,
      deliveryRate: 0.92,
      quality: "good",
      endpoint: "https://example.com/run?api_key=secret",
    });

    assert.equal(offer.paidAttempts, 12);
    assert.equal(offer.deliveryRate, 0.92);
    assert.equal(offer.quality, "good");
    assert.equal(offer.endpoint, "https://example.com/run?api_key=REDACTED");
  });
});

describe("public receipt projections", () => {
  it("passes receipts through — they are already pseudonymous", async () => {
    const { toPublicReceipt } = await import(rootUrl("src/lib/public-projections.ts"));

    const receipt = { _id: "receipt1", txHash: "0xabc", amountCents: 100 };
    assert.equal(toPublicReceipt(receipt), receipt);
  });
});
