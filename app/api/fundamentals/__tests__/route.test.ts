// app/api/fundamentals/__tests__/route.test.ts
//
// LEAPS-QV-0001 Gate 2b: the route requires a signed-in session and makes no outbound request without one.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

let mockUserId: string | null = null;

vi.mock('@/lib/ai/requireSession', () => ({ requireSessionUserId: async () => mockUserId }));

const realFetch = globalThis.fetch;
let fetchCalls = 0;

beforeEach(() => {
  mockUserId = null;
  fetchCalls = 0;
  globalThis.fetch = (async () => {
    fetchCalls += 1;
    throw new Error('network must not be reached in this test');
  }) as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('GET /api/fundamentals', () => {
  it('401 without a session and no outbound request', async () => {
    const { GET } = await import('../route');
    const res = await GET(new NextRequest('http://localhost/api/fundamentals?symbol=AAPL'));
    expect(res.status).toBe(401);
    expect(fetchCalls).toBe(0);
  });

  it('400 when signed in but the symbol is missing or unsupported', async () => {
    mockUserId = 'u1';
    const { GET } = await import('../route');
    expect((await GET(new NextRequest('http://localhost/api/fundamentals'))).status).toBe(400);
    expect((await GET(new NextRequest('http://localhost/api/fundamentals?symbol=%2E%2E%2Fetc'))).status).toBe(400);
    expect(fetchCalls).toBe(0);
  });
});
