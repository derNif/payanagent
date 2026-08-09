import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "../..");

function rootUrl(rel: string) {
  return pathToFileURL(resolve(root, rel)).href;
}

const SELLER = "0x2222222222222222222222222222222222222222";
const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const RESOURCE = "https://seller.example.com/api/run";

// The SSRF guard is exercised in ssrf.test.ts; here it is stubbed so probing is
// hermetic (no DNS, no egress).
let ssrfError: Error | null = null;
mock.module("@/lib/ssrf", {
  namedExports: {
    assertPublicHttpUrl: async () => {
      if (ssrfError) throw ssrfError;
    },
  },
});

const load = () => import(rootUrl("src/lib/external-verify.ts"));

type FetchCall = { url: string; init: RequestInit };
const calls: FetchCall[] = [];

function stubFetch(response: Response) {
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url: String(url), init });
    return response;
  }) as unknown as typeof globalThis.fetch;
}

function challenge(body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status: 402, headers });
}

function v2Accept(overrides: Record<string, unknown> = {}) {
  return {
    scheme: "exact",
    network: "eip155:8453",
    asset: USDC_BASE,
    payTo: SELLER,
    amount: "1000",
    ...overrides,
  };
}

describe("probeX402Resource — extracting terms", () => {
  it("reads x402 v2 terms from the JSON body", async () => {
    const { probeX402Resource } = await load();

    stubFetch(challenge({ x402Version: 2, accepts: [v2Accept()] }));
    assert.deepEqual(await probeX402Resource(RESOURCE), {
      payTo: SELLER,
      asset: USDC_BASE,
      network: "eip155:8453",
      amountRaw: "1000",
    });
  });

  it("reads x402 v1 terms (maxAmountRequired, network alias `base`)", async () => {
    const { probeX402Resource } = await load();

    stubFetch(
      challenge({
        accepts: [
          v2Accept({ network: "base", amount: undefined, maxAmountRequired: 2500 }),
        ],
      })
    );
    assert.deepEqual(await probeX402Resource(RESOURCE), {
      payTo: SELLER,
      asset: USDC_BASE,
      network: "base",
      amountRaw: "2500",
    });
  });

  it("reads base64 terms from any of the challenge headers", async () => {
    const { probeX402Resource } = await load();

    for (const header of ["payment-required", "x-payment-required", "www-authenticate"]) {
      const encoded = Buffer.from(
        JSON.stringify({ accepts: [v2Accept({ amount: "7" })] })
      ).toString("base64");
      // Body is unparseable on purpose — the header must be what's used.
      stubFetch(new Response("not json", { status: 402, headers: { [header]: encoded } }));

      const terms = await probeX402Resource(RESOURCE);
      assert.equal(terms.amountRaw, "7", header);
    }
  });

  it("prefers a USDC accept over another exact-scheme Base accept", async () => {
    const { probeX402Resource } = await load();

    stubFetch(
      challenge({
        accepts: [
          v2Accept({ asset: "0x4200000000000000000000000000000000000006", amount: "1" }),
          v2Accept({ asset: USDC_BASE.toLowerCase(), amount: "2" }),
        ],
      })
    );

    const terms = await probeX402Resource(RESOURCE);
    assert.equal(terms.amountRaw, "2");
    assert.equal(terms.asset, USDC_BASE.toLowerCase());
  });

  it("probes GET without a body and POST with an empty JSON body", async () => {
    const { probeX402Resource } = await load();

    calls.length = 0;
    stubFetch(challenge({ accepts: [v2Accept()] }));
    await probeX402Resource(RESOURCE);
    assert.equal(calls[0].init.method, "GET");
    assert.equal(calls[0].init.body, undefined);

    calls.length = 0;
    stubFetch(challenge({ accepts: [v2Accept()] }));
    await probeX402Resource(RESOURCE, "POST");
    assert.equal(calls[0].init.method, "POST");
    assert.equal(calls[0].init.body, "{}");
  });
});

describe("probeX402Resource — rejections", () => {
  it("propagates the SSRF guard's rejection before fetching", async () => {
    const { probeX402Resource } = await load();

    calls.length = 0;
    stubFetch(challenge({ accepts: [v2Accept()] }));
    ssrfError = new Error("URL resolves to a private or blocked address");
    try {
      await assert.rejects(() => probeX402Resource(RESOURCE), /private or blocked address/);
    } finally {
      ssrfError = null;
    }
    assert.equal(calls.length, 0);
  });

  it("rejects an unreachable resource", async () => {
    const { probeX402Resource } = await load();

    globalThis.fetch = (async () => {
      throw new Error("ECONNREFUSED");
    }) as typeof globalThis.fetch;

    await assert.rejects(() => probeX402Resource(RESOURCE), /could not reach/);
  });

  it("rejects any status other than 402", async () => {
    const { probeX402Resource } = await load();

    stubFetch(new Response("{}", { status: 200 }));
    await assert.rejects(
      () => probeX402Resource(RESOURCE, "POST"),
      /expected an HTTP 402 x402 challenge from POST .* got 200/
    );
  });

  it("rejects a 402 whose terms are unparseable or not exact-scheme Base USDC", async () => {
    const { probeX402Resource } = await load();

    const bad: unknown[] = [
      { accepts: "nope" },
      { accepts: [] },
      { accepts: [v2Accept({ scheme: "upto" })] },
      { accepts: [v2Accept({ network: "eip155:1" })] }, // not Base
      { accepts: [v2Accept({ payTo: undefined })] },
      { accepts: [v2Accept({ amount: undefined })] }, // no amount in either dialect
    ];

    for (const body of bad) {
      stubFetch(challenge(body));
      await assert.rejects(
        () => probeX402Resource(RESOURCE),
        /no parseable x402 terms/,
        JSON.stringify(body)
      );
    }
  });

  it("ignores an undecodable header and falls back to the body", async () => {
    const { probeX402Resource } = await load();

    stubFetch(
      challenge(
        { accepts: [v2Accept({ amount: "42" })] },
        { "payment-required": "%%%not-base64-json%%%" }
      )
    );

    const terms = await probeX402Resource(RESOURCE);
    assert.equal(terms.amountRaw, "42");
  });
});
