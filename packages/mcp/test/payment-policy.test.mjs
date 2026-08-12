import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "node:test";
import { privateKeyToAccount } from "viem/accounts";
import {
  configurePaymentPolicy,
  loadPaymentPolicy,
} from "../dist/payment-policy.mjs";

const signer = privateKeyToAccount(`0x${"01".repeat(32)}`);

function context() {
  return {
    walletAddress: signer.address,
    signer,
    fetchImpl: fetch,
    payanAgentBaseUrl: "https://payanagent.example",
    createUnguardedPaidFetch: () => fetch,
  };
}

async function moduleUrl(source) {
  const directory = await mkdtemp(join(tmpdir(), "payanagent-policy-"));
  const path = join(directory, "policy.mjs");
  await writeFile(path, source, { mode: 0o600 });
  return pathToFileURL(path).href;
}

test("loads a named payment policy factory with a signer interface", async () => {
  const policy = await loadPaymentPolicy(
    await moduleUrl(`
      export function createPaymentPolicy(context) {
        if (!context.walletAddress || context.signer.address !== context.walletAddress) {
          throw new Error("missing signer interface");
        }
        if ("privateKey" in context || "walletPrivateKey" in context) {
          throw new Error("raw secret leaked");
        }
        return async () => ({ abort: true, reason: "policy block" });
      }
    `),
    context(),
  );
  assert.deepEqual(await policy({}), {
    abort: true,
    reason: "policy block",
  });
});

test("supports a default async factory", async () => {
  const policy = await loadPaymentPolicy(
    await moduleUrl(`export default async () => async () => undefined;`),
    context(),
  );
  assert.equal(await policy({}), undefined);
});

test("rejects missing or invalid policy factories", async () => {
  await assert.rejects(
    loadPaymentPolicy(await moduleUrl(`export const value = 1;`), context()),
    /must export createPaymentPolicy/,
  );
  await assert.rejects(
    loadPaymentPolicy(await moduleUrl(`export default () => 42;`), context()),
    /must return an x402 before-payment hook/,
  );
});

test("attaches the hook only when a module is configured", async () => {
  const hooks = [];
  const client = {
    onBeforePaymentCreation(hook) {
      hooks.push(hook);
      return this;
    },
  };
  const common = {
    client,
    signer,
    fetchImpl: fetch,
    payanAgentBaseUrl: "https://payanagent.example",
    createUnguardedPaidFetch: () => fetch,
  };

  await configurePaymentPolicy(common);
  assert.equal(hooks.length, 0);

  await configurePaymentPolicy({
    ...common,
    moduleSpecifier: await moduleUrl(
      `export const createPaymentPolicy = () => async () => undefined;`,
    ),
  });
  assert.equal(hooks.length, 1);
});
