import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "../..");

function rootUrl(rel: string) {
  return pathToFileURL(resolve(root, rel)).href;
}

const ACTIVE_KEY_RECORD = {
  _id: "key1",
  agentId: "agent1",
  isActive: true,
};
const ACTIVE_AGENT = { _id: "agent1", name: "Searcher", status: "active" };

// Convex is stubbed: `queryResults` decides what each stubbed function returns.
let keyRecord: unknown = ACTIVE_KEY_RECORD;
let agent: unknown = ACTIVE_AGENT;
const mutations: string[] = [];

mock.module(rootUrl("convex/_generated/api.js"), {
  namedExports: {
    api: {
      apiKeys: { getByHash: "apiKeys:getByHash", updateLastUsed: "apiKeys:updateLastUsed" },
      agents: { getById: "agents:getById" },
    },
  },
});

mock.module(rootUrl("src/lib/convex.ts"), {
  namedExports: {
    PLATFORM_SECRET: "test-platform-secret",
    getConvexClient: () => ({
      query: async (fn: string) => {
        if (fn === "apiKeys:getByHash") return keyRecord;
        if (fn === "agents:getById") return agent;
        throw new Error(`unexpected query: ${fn}`);
      },
      mutation: async (fn: string) => {
        mutations.push(fn);
      },
    }),
  },
});

const load = () => import(rootUrl("src/lib/auth.ts"));

/** Each test needs its own IP/key so it lands in a fresh rate-limit bucket. */
let counter = 0;
function authedRequest(apiKey?: string) {
  counter++;
  const headers: Record<string, string> = { "x-real-ip": `203.0.113.${counter}` };
  if (apiKey) headers.authorization = `Bearer ${apiKey}`;
  return new Request("https://payanagent.com/api/v1/offers", { headers });
}

describe("API key generation", () => {
  it("issues a prefixed 32-byte key with its SHA-256 hash and display prefix", async () => {
    const { generateApiKey, hashApiKey } = await load();

    const { key, hash, prefix } = generateApiKey();

    assert.match(key, /^pk_test_[0-9a-f]{64}$/); // NODE_ENV is not "production" here
    assert.equal(hash, hashApiKey(key));
    assert.equal(hash, createHash("sha256").update(key).digest("hex"));
    assert.equal(prefix, key.slice(0, 12));
    assert.notEqual(generateApiKey().key, key, "keys must not repeat");
  });

  it("hashes deterministically and differently per key", async () => {
    const { hashApiKey } = await load();

    assert.equal(hashApiKey("pk_test_abc"), hashApiKey("pk_test_abc"));
    assert.notEqual(hashApiKey("pk_test_abc"), hashApiKey("pk_test_abd"));
  });
});

describe("authenticateRequest", () => {
  it("returns the agent for an active key", async () => {
    const { authenticateRequest } = await load();

    keyRecord = ACTIVE_KEY_RECORD;
    agent = ACTIVE_AGENT;
    mutations.length = 0;

    const result = await authenticateRequest(authedRequest("pk_test_valid"));
    assert.deepEqual(result.agent, ACTIVE_AGENT);
    assert.equal(result.error, undefined);
    assert.deepEqual(mutations, ["apiKeys:updateLastUsed"], "last-used is recorded");
  });

  it("401s a request with no or non-Bearer authorization", async () => {
    const { authenticateRequest } = await load();

    for (const request of [
      authedRequest(),
      new Request("https://payanagent.com/api/v1/offers", {
        headers: { "x-real-ip": "203.0.113.200", authorization: "Basic abc" },
      }),
    ]) {
      const { error } = await authenticateRequest(request);
      assert.equal(error!.status, 401);
      assert.match((await error!.json()).error, /Unauthorized/);
    }
  });

  it("401s an unknown, revoked or inactive-agent key", async () => {
    const { authenticateRequest } = await load();

    keyRecord = null;
    assert.equal((await authenticateRequest(authedRequest("pk_test_1"))).error!.status, 401);

    keyRecord = { ...ACTIVE_KEY_RECORD, isActive: false };
    assert.equal((await authenticateRequest(authedRequest("pk_test_2"))).error!.status, 401);

    keyRecord = ACTIVE_KEY_RECORD;
    agent = { ...ACTIVE_AGENT, status: "suspended" };
    assert.equal((await authenticateRequest(authedRequest("pk_test_3"))).error!.status, 401);

    agent = null;
    assert.equal((await authenticateRequest(authedRequest("pk_test_4"))).error!.status, 401);
  });

  it("429s with Retry-After once the per-IP ceiling is hit, before any DB lookup", async () => {
    const { authenticateRequest } = await load();

    keyRecord = ACTIVE_KEY_RECORD;
    agent = ACTIVE_AGENT;

    // Same IP, rotating bearer tokens: the per-IP bucket must still fill up, or a
    // client could fan out unbounded key lookups.
    const ip = "198.51.100.42";
    const request = (token: string) =>
      new Request("https://payanagent.com/api/v1/offers", {
        headers: { "x-real-ip": ip, authorization: `Bearer ${token}` },
      });

    let limited: Response | undefined;
    for (let i = 0; i < 200; i++) {
      const { error } = await authenticateRequest(request(`pk_test_rotate_${i}`));
      if (error?.status === 429) {
        limited = error;
        break;
      }
    }

    assert.ok(limited, "expected a 429 within 200 requests from one IP");
    assert.match((await limited.json()).error, /Too many requests/);
    assert.ok(Number(limited.headers.get("Retry-After")) > 0);
  });
});

describe("legacy response helpers", () => {
  it("still return the shared 401 and 429 bodies", async () => {
    const { unauthorizedResponse_legacy, rateLimitResponse } = await load();

    assert.equal(unauthorizedResponse_legacy().status, 401);

    const limited = rateLimitResponse(Date.now() + 30_000);
    assert.equal(limited.status, 429);
    assert.equal(limited.headers.get("Retry-After"), "30");
  });
});
