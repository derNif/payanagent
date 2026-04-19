import { describe, it, mock, before, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '../..');

function rootUrl(rel: string) {
  return pathToFileURL(resolve(root, rel)).href;
}

const fakeAgent = { _id: 'agent-1' };
const fakeService = {
  isActive: true,
  serviceType: 'api',
  endpoint: 'http://example.com/svc',
  priceInCents: 100,
  name: 'Test Service',
  agentId: 'agent-2',
  httpMethod: 'POST',
};

describe('POST /api/v1/services/:serviceId/invoke — failed settlement', () => {
  let mutationSpy: ReturnType<typeof mock.fn>;

  before(async () => {
    mutationSpy = mock.fn(async () => 'tx-id');

    // next/server is intercepted by test-loader.mjs which provides an inline shim.
    // We still register it with mock.module using the shim URL so the route's import is mocked.
    await mock.module(rootUrl('src/lib/auth.ts'), {
      exports: {
        authenticateRequest: async () => ({ agent: fakeAgent, error: null }),
      },
    });

    await mock.module(rootUrl('src/lib/convex.ts'), {
      exports: {
        getConvexClient: () => ({
          query: async () => fakeService,
          mutation: mutationSpy,
        }),
      },
    });

    await mock.module(rootUrl('src/lib/x402.ts'), {
      exports: {
        buildPaymentRequiredResponse: () => new Response('{}', { status: 402 }),
        verifyPaymentIntegrity: () => ({ valid: true }),
        verifyPayment: async () => ({ valid: true }),
        settlePayment: async () => ({ success: false, error: 'insufficient funds' }),
        getFacilitatorUrl: () => 'http://facilitator',
        getNetwork: () => 'base-sepolia',
        getNetworkId: () => 84532,
      },
    });

    await mock.module(rootUrl('convex/_generated/api.js'), {
      exports: {
        api: {
          services: { getById: 'services:getById' },
          transactions: { create: 'transactions:create' },
        },
      },
    });
  });

  afterEach(() => {
    mutationSpy.mock.resetCalls();
  });

  it('returns 402 when settlement fails', async () => {
    const { POST } = await import(rootUrl('src/app/api/v1/services/[serviceId]/invoke/route.ts'));

    const req = new Request('http://localhost/api/v1/services/svc-1/invoke', {
      method: 'POST',
      headers: {
        'payment-signature': 'sig-abc',
        'payment-required': 'pr-abc',
      },
      body: JSON.stringify({ input: 'test' }),
    });

    const params = Promise.resolve({ serviceId: 'svc-1' });
    const response = await POST(req as never, { params });

    assert.equal(response.status, 402, 'Expected HTTP 402 on failed settlement');

    const body = await response.json();
    assert.match(body.error, /Payment settlement failed.*insufficient funds/);
  });

  it('does not call convex mutation when settlement fails', async () => {
    const { POST } = await import(rootUrl('src/app/api/v1/services/[serviceId]/invoke/route.ts'));

    const req = new Request('http://localhost/api/v1/services/svc-1/invoke', {
      method: 'POST',
      headers: {
        'payment-signature': 'sig-abc',
        'payment-required': 'pr-abc',
      },
      body: JSON.stringify({ input: 'test' }),
    });

    const params = Promise.resolve({ serviceId: 'svc-1' });
    await POST(req as never, { params });

    assert.equal(mutationSpy.mock.calls.length, 0, 'Expected no Convex mutation on failed settlement');
  });
});
