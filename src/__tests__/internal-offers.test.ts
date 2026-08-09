import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "../..");

function rootUrl(rel: string) {
  return pathToFileURL(resolve(root, rel)).href;
}

const upstreamCalls: { tool: string; input: Record<string, unknown> }[] = [];
mock.module(pathToFileURL(resolve(root, "src/lib/labs-upstream.ts")).href, {
  namedExports: {
    runUpstream: async (tool: string, input: Record<string, unknown>) => {
      upstreamCalls.push({ tool, input });
      return { ok: true, tool };
    },
  },
});

const load = () => import(rootUrl("src/lib/internal-offers.ts"));

describe("runInternalHandler", () => {
  it("routes a labs handler to the upstream tool it names", async () => {
    const { runInternalHandler } = await load();

    upstreamCalls.length = 0;
    const result = await runInternalHandler("labs:search", { query: "x402" });

    assert.deepEqual(result, { ok: true, tool: "search" });
    assert.deepEqual(upstreamCalls, [{ tool: "search", input: { query: "x402" } }]);
  });

  it("rejects an unknown handler group", async () => {
    const { runInternalHandler } = await load();

    await assert.rejects(
      () => runInternalHandler("evil:exfiltrate", {}),
      /unknown internal handler: evil:exfiltrate/
    );
    await assert.rejects(() => runInternalHandler("", {}), /unknown internal handler/);
  });
});
