import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "../..");

const load = () => import(pathToFileURL(resolve(root, "src/lib/relay-url.ts")).href);

describe("buildRelayUrls", () => {
  it("forwards buyer query input while preserving the registered origin and path", async () => {
    const { buildRelayUrls } = await load();
    const result = buildRelayUrls({
      requestUrl: "https://payanagent.com/x402/offer-1?url=https%3A%2F%2Fopenai.com&format=markdown",
      externalUrl: "https://seller.example/extract?url=https%3A%2F%2Fexample.com",
      offerId: "offer-1",
      appUrl: "https://payanagent.com",
    });

    assert.equal(
      result.sellerUrl,
      "https://seller.example/extract?url=https%3A%2F%2Fopenai.com&format=markdown",
    );
    assert.equal(
      result.canonicalUrl,
      "https://payanagent.com/x402/offer-1?url=https%3A%2F%2Fopenai.com&format=markdown",
    );
  });

  it("keeps the registration example when a buyer supplies no query", async () => {
    const { buildRelayUrls } = await load();
    const result = buildRelayUrls({
      requestUrl: "https://payanagent.com/x402/offer-1",
      externalUrl: "https://seller.example/extract?url=https%3A%2F%2Fexample.com",
      offerId: "offer-1",
      appUrl: "https://payanagent.com",
    });

    assert.equal(
      result.sellerUrl,
      "https://seller.example/extract?url=https%3A%2F%2Fexample.com",
    );
    assert.equal(result.canonicalUrl, "https://payanagent.com/x402/offer-1");
  });

  it("cannot change the seller origin or path through buyer input", async () => {
    const { buildRelayUrls } = await load();
    const result = buildRelayUrls({
      requestUrl: "https://attacker.invalid/not-the-buy-route?target=https%3A%2F%2Fevil.invalid",
      externalUrl: "https://seller.example/safe/path?target=registered",
      offerId: "offer-1",
      appUrl: "https://payanagent.com",
    });

    assert.equal(new URL(result.sellerUrl).origin, "https://seller.example");
    assert.equal(new URL(result.sellerUrl).pathname, "/safe/path");
    assert.equal(new URL(result.canonicalUrl).origin, "https://payanagent.com");
    assert.equal(new URL(result.canonicalUrl).pathname, "/x402/offer-1");
  });
});
