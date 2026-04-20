import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '../..');

function rootUrl(rel: string) {
  return pathToFileURL(resolve(root, rel)).href;
}

describe('checkRateLimit — in-memory fallback (no Upstash env vars)', () => {
  it('returns allowed:false after exceeding the unauthenticated limit', async () => {
    // Env vars are absent in the test environment — in-memory path is used.
    const { checkRateLimit, RATE_LIMITS } = await import(rootUrl('src/lib/rate-limit.ts'));

    const config = RATE_LIMITS.unauthenticated; // limit: 30, windowSeconds: 60
    const key = `test:rate-limit:${Date.now()}`;

    // Exhaust the limit
    for (let i = 0; i < config.limit; i++) {
      const result = await checkRateLimit(key, config);
      assert.equal(result.allowed, true, `Expected allowed on request ${i + 1}`);
    }

    // Next request should be denied
    const denied = await checkRateLimit(key, config);
    assert.equal(denied.allowed, false, 'Expected allowed:false after limit exceeded');
    assert.equal(denied.remaining, 0);
    assert.ok(denied.resetAt > Date.now(), 'resetAt should be in the future');
  });
});
