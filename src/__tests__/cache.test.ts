import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "../..");

function rootUrl(rel: string) {
  return pathToFileURL(resolve(root, rel)).href;
}

describe("cacheHeaders", () => {
  it("emits a public CDN cache policy with stale-while-revalidate", async () => {
    const { cacheHeaders } = await import(rootUrl("src/lib/cache.ts"));

    assert.deepEqual(cacheHeaders(60), {
      "Cache-Control": "public, s-maxage=60, stale-while-revalidate=60",
    });
  });
});
