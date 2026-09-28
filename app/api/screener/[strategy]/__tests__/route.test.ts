// app/api/screener/[strategy]/__tests__/route.test.ts
//
// SEC-0001 S3: screener/[strategy] previously had zero session check while
// sending a server-side, cost-incurring credential (MARKET_DATA_API_TOKEN)
// to an external provider for whatever symbols the caller supplied. This
// confirms the session gate added to close that gap.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ userId: 'user-a' as string | null }));
vi.mock('@/lib/ai/requireSession', () => ({ requireSessionUserId: async () => h.userId }));
vi.mock('@/lib/screener/provider', () => ({
  fetchOptionChainFromProvider: vi.fn(async () => ({ contracts: [] })),
  fetchOptionChainsConcurrently: vi.fn(async (symbols: string[]) => new Map(symbols.map(s => [s, { contracts: [] }]))),
}));

beforeEach(() => { h.userId = 'user-a'; });
afterEach(() => { vi.restoreAllMocks(); });

function post(body: unknown) {
  return new Request('http://localhost/api/screener/csp', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }) as any;
}

describe('POST /api/screener/[strategy]', () => {
  it('401s when signed out, before reading the body or touching the provider', async () => {
    h.userId = null;
    const { fetchOptionChainsConcurrently } = await import('@/lib/screener/provider');
    const { POST } = await import('../route');
    const res = await POST(post({ symbols: ['AAPL'] }), { params: { strategy: 'csp' } });
    expect(res.status).toBe(401);
    expect(fetchOptionChainsConcurrently).not.toHaveBeenCalled();
  });

  it('proceeds normally for a signed-in caller', async () => {
    const { POST } = await import('../route');
    const res = await POST(post({ symbols: ['AAPL'] }), { params: { strategy: 'csp' } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
  });

  it('still validates a missing symbols array for a signed-in caller (unrelated to auth)', async () => {
    const { POST } = await import('../route');
    const res = await POST(post({ symbols: [] }), { params: { strategy: 'csp' } });
    expect(res.status).toBe(400);
  });
});
