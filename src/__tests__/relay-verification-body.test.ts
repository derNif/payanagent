import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "../..");

function rootUrl(rel: string) {
  return pathToFileURL(resolve(root, rel)).href;
}

describe("relay offer verificationBody", () => {
  it("serializes the supplied verification body for non-GET probes", async () => {
    const { buildProbeRequestBody } = await import(
      rootUrl("src/lib/external-verify.ts")
    );

    assert.equal(
      buildProbeRequestBody("POST", { jurisdiction: "US" }),
      '{"jurisdiction":"US"}',
    );
    assert.equal(buildProbeRequestBody("POST"), "{}");
    assert.equal(buildProbeRequestBody("GET", { ignored: true }), undefined);
  });

  it("accepts a bounded body for an explicit POST relay", async () => {
    const { createOfferSchema } = await import(rootUrl("src/lib/validation.ts"));
    const parsed = createOfferSchema.parse({
      title: "Input-requiring x402 API",
      description: "Returns a 402 only after validating required input.",
      category: "Data",
      offerType: "api",
      externalUrl: "https://example.com/x402/report",
      httpMethod: "POST",
      verificationBody: { jurisdiction: "US" },
    });

    assert.deepEqual(parsed.verificationBody, { jurisdiction: "US" });
  });

  it("rejects verificationBody for native and implicit-GET offers", async () => {
    const { createOfferSchema } = await import(rootUrl("src/lib/validation.ts"));
    const common = {
      title: "Offer",
      description: "Description",
      category: "Data",
      offerType: "api" as const,
      verificationBody: { jurisdiction: "US" },
    };

    assert.equal(
      createOfferSchema.safeParse({
        ...common,
        priceCents: 1,
        endpoint: "https://example.com/native",
        httpMethod: "POST",
      }).success,
      false,
    );
    assert.equal(
      createOfferSchema.safeParse({
        ...common,
        externalUrl: "https://example.com/x402/report",
      }).success,
      false,
    );
  });

  it("rejects bodies above the registration-probe limit", async () => {
    const { createOfferSchema } = await import(rootUrl("src/lib/validation.ts"));
    const result = createOfferSchema.safeParse({
      title: "Offer",
      description: "Description",
      category: "Data",
      offerType: "api",
      externalUrl: "https://example.com/x402/report",
      httpMethod: "POST",
      verificationBody: { input: "x".repeat(16_384) },
    });

    assert.equal(result.success, false);
  });
});
