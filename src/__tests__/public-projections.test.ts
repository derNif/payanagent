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
});
