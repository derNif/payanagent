import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "../..");

function rootUrl(rel: string) {
  return pathToFileURL(resolve(root, rel)).href;
}

const load = () => import(rootUrl("src/lib/validation.ts"));

const WALLET = "0x1111111111111111111111111111111111111111";

/** All the messages a failed parse produced, joined for easy matching. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function messages(result: any): string {
  assert.equal(result.success, false, "expected the schema to reject this input");
  return result.error.issues.map((i: { message: string }) => i.message).join(" | ");
}

describe("registerAgentSchema", () => {
  it("applies defaults and accepts a minimal registration", async () => {
    const { registerAgentSchema } = await load();

    const parsed = registerAgentSchema.parse({
      name: "Searcher",
      description: "Finds things",
      walletAddress: WALLET,
    });
    assert.equal(parsed.chain, "base");
    assert.equal(parsed.providerType, "agent");
    assert.deepEqual(parsed.tags, []);
  });

  it("rejects a malformed wallet address", async () => {
    const { registerAgentSchema } = await load();

    for (const walletAddress of [WALLET.slice(0, -1), WALLET.replace("0x", ""), "0xzz"]) {
      const result = registerAgentSchema.safeParse({
        name: "n",
        description: "d",
        walletAddress,
      });
      assert.match(messages(result), /Invalid wallet address/, walletAddress);
    }
  });

  it("rejects bad enums, urls, emails and oversized fields", async () => {
    const { registerAgentSchema } = await load();

    const result = registerAgentSchema.safeParse({
      name: "",
      description: "d",
      walletAddress: WALLET,
      providerType: "human",
      agentUrl: "not-a-url",
      ownerEmail: "not-an-email",
      tags: Array.from({ length: 21 }, () => "t"),
    });
    assert.equal(result.success, false);
    assert.equal(result.error.issues.length, 5);
  });
});

describe("createOfferSchema", () => {
  const baseOffer = {
    title: "Web search",
    description: "Search the web",
    category: "search",
  };

  it("accepts an API offer that PayanAgent settles and proxies", async () => {
    const { createOfferSchema } = await load();

    const parsed = createOfferSchema.parse({
      ...baseOffer,
      offerType: "api",
      priceCents: 100,
      endpoint: "https://seller.example.com/run",
    });
    assert.equal(parsed.priceCents, 100);
  });

  it("accepts a relay offer without priceCents (price comes from the verified 402)", async () => {
    const { createOfferSchema } = await load();

    const parsed = createOfferSchema.parse({
      ...baseOffer,
      offerType: "api",
      externalUrl: "https://gated.example.com/run",
    });
    assert.equal(parsed.priceCents, undefined);
  });

  it("requires priceCents for non-relay offers", async () => {
    const { createOfferSchema } = await load();

    const result = createOfferSchema.safeParse({
      ...baseOffer,
      offerType: "api",
      endpoint: "https://seller.example.com/run",
    });
    assert.match(messages(result), /priceCents is required/);
  });

  it("requires an endpoint or externalUrl for API offers", async () => {
    const { createOfferSchema } = await load();

    const result = createOfferSchema.safeParse({
      ...baseOffer,
      offerType: "api",
      priceCents: 100,
    });
    assert.match(messages(result), /API offers require an endpoint URL/);
  });

  it("rejects an offer carrying both endpoint and externalUrl", async () => {
    const { createOfferSchema } = await load();

    const result = createOfferSchema.safeParse({
      ...baseOffer,
      offerType: "api",
      priceCents: 100,
      endpoint: "https://seller.example.com/run",
      externalUrl: "https://gated.example.com/run",
    });
    assert.match(messages(result), /not both/);
  });

  it("rejects externalUrl on a download offer", async () => {
    const { createOfferSchema } = await load();

    const result = createOfferSchema.safeParse({
      ...baseOffer,
      offerType: "download",
      priceCents: 100,
      fileUrl: "https://cdn.example.com/f.zip",
      externalUrl: "https://gated.example.com/run",
    });
    assert.match(messages(result), /only valid for API offers/);
  });

  it("requires a fileUrl for download offers", async () => {
    const { createOfferSchema } = await load();

    const result = createOfferSchema.safeParse({
      ...baseOffer,
      offerType: "download",
      priceCents: 100,
    });
    assert.match(messages(result), /Download offers require a fileUrl/);
  });

  it("rejects prices that are not whole cents in range", async () => {
    const { createOfferSchema } = await load();

    for (const priceCents of [0, -1, 1.5, 10_000_001]) {
      const result = createOfferSchema.safeParse({
        ...baseOffer,
        offerType: "api",
        endpoint: "https://seller.example.com/run",
        priceCents,
      });
      assert.equal(result.success, false, String(priceCents));
    }
  });
});

describe("createRequestSchema", () => {
  const baseRequest = { title: "Need data", description: "Scrape it", budgetMaxCents: 5000 };

  it("defaults escrow to false", async () => {
    const { createRequestSchema } = await load();

    assert.equal(createRequestSchema.parse(baseRequest).escrow, false);
  });

  it("requires agreedPriceCents for a direct hire", async () => {
    const { createRequestSchema } = await load();

    const result = createRequestSchema.safeParse({ ...baseRequest, providerId: "agent123" });
    assert.match(messages(result), /direct hire requires agreedPriceCents/);

    const parsed = createRequestSchema.parse({
      ...baseRequest,
      providerId: "agent123",
      agreedPriceCents: 4000,
    });
    assert.equal(parsed.agreedPriceCents, 4000);
  });
});

describe("validateBody", () => {
  function jsonRequest(body: string) {
    return new Request("https://payanagent.com/api/v1/offers", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    });
  }

  it("returns parsed data for a valid body", async () => {
    const { validateBody, cancelSchema } = await load();

    const result = await validateBody(
      jsonRequest(JSON.stringify({ reason: "changed my mind" })),
      cancelSchema
    );
    assert.deepEqual(result.data, { reason: "changed my mind" });
    assert.equal(result.error, undefined);
  });

  it("returns a 400 listing every validation issue with its field path", async () => {
    const { validateBody, fulfillRequestSchema } = await load();

    const result = await validateBody(
      jsonRequest(JSON.stringify({ outputPayload: "" })),
      fulfillRequestSchema
    );
    assert.equal(result.data, undefined);
    assert.equal(result.error!.status, 400);
    assert.deepEqual(await result.error!.json(), {
      error: "Validation failed",
      details: ["outputPayload: outputPayload is required"],
    });
  });

  it("returns a 400 for a body that is not JSON", async () => {
    const { validateBody, cancelSchema } = await load();

    const result = await validateBody(jsonRequest("not json"), cancelSchema);
    assert.equal(result.error!.status, 400);
    assert.deepEqual(await result.error!.json(), { error: "Invalid JSON body" });
  });
});
