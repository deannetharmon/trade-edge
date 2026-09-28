// app/api/chart-history/__tests__/route.test.ts
//
// WHEEL-SYSTEM-0003 Slice B: session required, bad symbol, years bounds, Yahoo failure.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const h = vi.hoisted(() => ({ userId: 'user-a' as string | null }));
vi.mock('@/lib/ai/requireSession', () => ({ requireSessionUserId: async () => h.userId }));

beforeEach(() => { h.userId = 'user-a'; });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function req(query: string) {
  return new NextRequest(`http://localhost/api/chart-history${query}`);
}

function yahooOk(timestamps: number[], closes: (number | null)[]) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ chart: { result: [{ timestamp: timestamps, indicators: { quote: [{ close: closes }] } }] } }),
  } as Response;
}

describe('GET /api/chart-history', () => {
  it('401s when signed out, before ever calling Yahoo', async () => {
    h.userId = null;
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { GET } = await import('../route');
    const res = await GET(req('?symbol=AAPL'));
    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('400s when symbol is missing', async () => {
    const { GET } = await import('../route');
    const res = await GET(req('?years=5'));
    expect(res.status).toBe(400);
  });

  it('400s when years is out of bounds or not a whole number', async () => {
    const { GET } = await import('../route');
    for (const bad of ['0', '11', '5.5', 'abc', '-1']) {
      const res = await GET(req(`?symbol=AAPL&years=${bad}`));
      expect(res.status).toBe(400);
    }
  });

  it('defaults to 5 years when years is omitted', async () => {
    const fetchMock = vi.fn(async (url: string) => { expect(url).toContain('range=5y'); return yahooOk([1, 2], [100, 101]); });
    vi.stubGlobal('fetch', fetchMock);
    const { GET } = await import('../route');
    const res = await GET(req('?symbol=AAPL'));
    expect(res.status).toBe(200);
  });

  it('accepts years at the bounds (1 and 10)', async () => {
    const fetchMock = vi.fn(async () => yahooOk([1], [100]));
    vi.stubGlobal('fetch', fetchMock);
    const { GET } = await import('../route');
    expect((await GET(req('?symbol=AAPL&years=1'))).status).toBe(200);
    expect((await GET(req('?symbol=AAPL&years=10'))).status).toBe(200);
  });

  it('returns closes in date order, using the quote series (never adjclose)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true, status: 200,
      json: async () => ({
        chart: {
          result: [{
            timestamp: [1000, 2000, 3000],
            indicators: { quote: [{ close: [100, 101, null] }], adjclose: [{ adjclose: [90, 91, 92] }] },
          }],
        },
      }),
    } as Response)));
    const { GET } = await import('../route');
    const res = await GET(req('?symbol=AAPL&years=5'));
    const body = await res.json();
    // The null close is dropped; the other two use the quote series, not adjclose.
    expect(body.closes).toEqual([{ t: 1000, c: 100 }, { t: 2000, c: 101 }]);
  });

  it('propagates a Yahoo error status', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 429, json: async () => ({}) } as Response)));
    const { GET } = await import('../route');
    const res = await GET(req('?symbol=AAPL'));
    expect(res.status).toBe(429);
  });

  it('404s when Yahoo returns no result', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ chart: { result: [] } }) } as Response)));
    const { GET } = await import('../route');
    const res = await GET(req('?symbol=BADSYM'));
    expect(res.status).toBe(404);
  });

  it('500s and reports the message when the fetch itself throws', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down'); }));
    const { GET } = await import('../route');
    const res = await GET(req('?symbol=AAPL'));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe('network down');
  });
});
