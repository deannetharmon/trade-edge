// app/api/paper-trading/__tests__/security.test.ts
//
// PT-0001 section 14 "Security and isolation": unauthenticated mutations
// reject, and a caller-supplied user id in the request body can never
// select another account -- routes resolve the user server-side via
// resolveAutopilotUserId() and never read body.userId.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeRedisClient } from '@/lib/paper-trading/__tests__/testUtils/fakeRedisClient';

let mockRedis: FakeRedisClient;
let mockResolvedUserId: string | null = 'real-user';

vi.mock('@/lib/autopilot/persistence/redis', () => ({
  withAutopilotRedis: async (fn: (redis: FakeRedisClient) => unknown) => fn(mockRedis),
}));

vi.mock('@/lib/autopilot/server/auth', () => ({
  resolveAutopilotUserId: async () => mockResolvedUserId,
}));

beforeEach(() => {
  mockRedis = new FakeRedisClient();
  mockResolvedUserId = 'real-user';
});

function jsonRequest(body: unknown): Request {
  return new Request('http://localhost/api/paper-trading/positions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('unauthenticated mutations reject', () => {
  it('GET /api/paper-trading/account returns 401 when no user resolves', async () => {
    mockResolvedUserId = null;
    const { GET } = await import('../account/route');
    const res = await GET(new Request('http://localhost/api/paper-trading/account'));
    expect(res.status).toBe(401);
  });

  it('POST /api/paper-trading/positions returns 401 when no user resolves', async () => {
    mockResolvedUserId = null;
    const { POST } = await import('../positions/route');
    const res = await POST(jsonRequest({ idempotencyKey: 'k1', symbol: 'SPY', strategy: 'CSP', expiration: '2026-08-21', quantity: 1, legs: [] }));
    expect(res.status).toBe(401);
  });

  it('POST /api/paper-trading/account/reset returns 401 when no user resolves', async () => {
    mockResolvedUserId = null;
    const { POST } = await import('../account/reset/route');
    const res = await POST(jsonRequest({ idempotencyKey: 'k1', startingBalance: 1000 }));
    expect(res.status).toBe(401);
  });
});

describe('caller-supplied user id cannot select another account', () => {
  it('a userId field in the request body is ignored -- the account acted on is always the resolved session user', async () => {
    const { POST } = await import('../positions/route');
    const res = await POST(
      jsonRequest({
        userId: 'someone-elses-account', // must be ignored
        idempotencyKey: 'k1',
        symbol: 'SPY',
        strategy: 'CSP',
        expiration: '2026-08-21',
        quantity: 1,
        legs: [{ legId: 'p', optionType: 'put', strike: 100, expiration: '2026-08-21', openAction: 'sell_to_open' }],
        quoteSnapshot: {
          source: 'manual',
          legs: [{ legId: 'p', bid: 3.0, ask: 3.2, mid: null, quoteTimestamp: new Date().toISOString() }],
        },
      }),
    );
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.position.userId).toBe('real-user');
    expect(body.position.userId).not.toBe('someone-elses-account');
  });
});
