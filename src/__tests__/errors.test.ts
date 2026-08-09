import { describe, it, mock, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '../..');

function rootUrl(rel: string) {
  return pathToFileURL(resolve(root, rel)).href;
}

const load = () => import(rootUrl('src/lib/errors.ts'));

describe('errorMessage', () => {
  it('unwraps Errors, keeps non-empty strings, and falls back otherwise', async () => {
    const { errorMessage } = await load();
    assert.equal(errorMessage(new Error('boom')), 'boom');
    assert.equal(errorMessage('boom'), 'boom');
    assert.equal(errorMessage(''), 'unknown error');
    assert.equal(errorMessage(undefined, 'fallback'), 'fallback');
    assert.equal(errorMessage({ message: 'not an Error' }), 'unknown error');
  });
});

describe('isUpstreamUnavailable', () => {
  it('classifies transport failures as upstream, not caller errors', async () => {
    const { isUpstreamUnavailable } = await load();
    assert.equal(isUpstreamUnavailable(new TypeError('fetch failed')), true);
    assert.equal(isUpstreamUnavailable(new Error('connect ECONNREFUSED 1.2.3.4:443')), true);
    assert.equal(isUpstreamUnavailable(new Error('getaddrinfo ENOTFOUND convex.cloud')), true);
    assert.equal(isUpstreamUnavailable(new Error('socket hang up')), true);
    // A malformed document id is the caller's problem, not an outage.
    assert.equal(isUpstreamUnavailable(new Error('Invalid ID "abc" for table offers')), false);
  });
});

describe('response helpers', () => {
  let errors: string[];
  const originalConsoleError = console.error;

  beforeEach(() => {
    errors = [];
    console.error = (...args: unknown[]) => {
      errors.push(args.map(String).join(' '));
    };
  });

  afterEach(() => {
    console.error = originalConsoleError;
    mock.reset();
  });

  it('lookupErrorResponse: 400 for a bad id, 503 for an unreachable store', async () => {
    const { lookupErrorResponse } = await load();

    const bad = lookupErrorResponse('t:lookup', new Error('Invalid ID'), 'Invalid offer ID', {
      offerId: 'o1',
    });
    assert.equal(bad.status, 400);
    assert.deepEqual(await bad.json(), { error: 'Invalid offer ID' });

    const down = lookupErrorResponse('t:lookup', new TypeError('fetch failed'), 'Invalid offer ID');
    assert.equal(down.status, 503);
    assert.equal(down.headers.get('Retry-After'), '2');

    assert.equal(errors.length, 2, 'both branches must log');
    assert.ok(errors[0].includes('[t:lookup]') && errors[0].includes('o1'));
  });

  it('internalErrorResponse: hides the cause from the client but logs it', async () => {
    const { internalErrorResponse } = await load();

    const res = internalErrorResponse('t:internal', new Error('convex table secret leak'));
    assert.equal(res.status, 500);
    assert.deepEqual(await res.json(), { error: 'Internal server error' });
    assert.ok(errors[0].includes('convex table secret leak'));
  });

  it('swallow: resolves to null and logs the swallowed error', async () => {
    const { swallow } = await load();

    const result = await Promise.reject(new Error('bookkeeping failed')).catch(
      swallow('t:swallow', { receiptId: 'r1' }),
    );
    assert.equal(result, null);
    assert.ok(errors[0].includes('[t:swallow]'));
    assert.ok(errors[0].includes('r1'));
  });

  it('logError: includes the cause chain', async () => {
    const { logError } = await load();

    logError('t:cause', new Error('outer', { cause: new Error('inner') }));
    assert.ok(errors[0].includes('outer'));
    assert.ok(errors[0].includes('inner'));
  });
});
