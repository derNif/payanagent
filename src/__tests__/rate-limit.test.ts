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

  it('counts down remaining and keeps a stable window per key', async () => {
    const { checkRateLimit } = await import(rootUrl('src/lib/rate-limit.ts'));

    const config = { limit: 3, windowSeconds: 60 };
    const key = `test:remaining:${Date.now()}`;

    const first = await checkRateLimit(key, config);
    const second = await checkRateLimit(key, config);
    const third = await checkRateLimit(key, config);

    assert.deepEqual(
      [first.remaining, second.remaining, third.remaining],
      [2, 1, 0],
      'remaining should count down to 0'
    );
    assert.equal(third.allowed, true, 'the request at the limit is still allowed');
    assert.equal(first.resetAt, third.resetAt, 'the window must not slide per request');
  });

  it('starts a fresh window once the previous one has expired', async () => {
    const { checkRateLimit } = await import(rootUrl('src/lib/rate-limit.ts'));

    const config = { limit: 1, windowSeconds: 0.05 };
    const key = `test:expiry:${Date.now()}`;

    assert.equal((await checkRateLimit(key, config)).allowed, true);
    assert.equal((await checkRateLimit(key, config)).allowed, false);

    await new Promise((r) => setTimeout(r, 80));
    assert.equal((await checkRateLimit(key, config)).allowed, true);
  });

  it('tracks each key in its own bucket', async () => {
    const { checkRateLimit } = await import(rootUrl('src/lib/rate-limit.ts'));

    const config = { limit: 1, windowSeconds: 60 };
    const stamp = Date.now();

    assert.equal((await checkRateLimit(`test:a:${stamp}`, config)).allowed, true);
    assert.equal((await checkRateLimit(`test:a:${stamp}`, config)).allowed, false);
    assert.equal((await checkRateLimit(`test:b:${stamp}`, config)).allowed, true);
  });
});

describe('getClientIp', () => {
  function requestWith(headers: Record<string, string>) {
    return new Request('https://payanagent.com/api/v1/discover', { headers });
  }

  it('prefers the platform-set x-real-ip', async () => {
    const { getClientIp } = await import(rootUrl('src/lib/rate-limit.ts'));

    assert.equal(
      getClientIp(
        requestWith({ 'x-real-ip': ' 203.0.113.7 ', 'x-forwarded-for': '1.2.3.4' })
      ),
      '203.0.113.7'
    );
  });

  it('takes the right-most x-forwarded-for hop — never the client-supplied left-most one', async () => {
    const { getClientIp } = await import(rootUrl('src/lib/rate-limit.ts'));

    assert.equal(
      getClientIp(requestWith({ 'x-forwarded-for': '9.9.9.9, 8.8.8.8, 203.0.113.7' })),
      '203.0.113.7'
    );
    assert.equal(
      getClientIp(requestWith({ 'x-forwarded-for': '203.0.113.7,, ' })),
      '203.0.113.7'
    );
  });

  it('falls back to "unknown" when no trusted header is present', async () => {
    const { getClientIp } = await import(rootUrl('src/lib/rate-limit.ts'));

    assert.equal(getClientIp(requestWith({})), 'unknown');
    assert.equal(getClientIp(requestWith({ 'x-real-ip': '  ' })), 'unknown');
    assert.equal(getClientIp(requestWith({ 'x-forwarded-for': ' , ' })), 'unknown');
  });
});
