// app/api/historical-growth/__tests__/route.test.ts
//
// DATA-CACHE-0001: session required, validation, CAGR result, cache hit, errors not cached.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createMemoryCacheStore, setSharedCacheStoreForTests } from '@/lib/cache/sharedCache';

const h = vi.hoisted(() => ({ userId: 'user-a' as string | null }));
vi.mock('@/lib/ai/requireSession', () => ({ requireSessionUserId: async () => h.userId }));

beforeEach(() => { h.userId = 'user-a'; setSharedCacheStoreForTests(createMemoryCacheStore()); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); setSharedCacheStoreForTests(null); });

const req = (q: string) => new NextRequest(`http://localhost/api/historical-growth${q}`);
const YEAR = 365.25 * 24 * 60 * 60;
// 100 -> 121 over exactly 2 years = 10%/yr
const ok = () => ({
  ok: true, status: 200,
  json: async () => ({ chart: { result: [{ timestamp: [0, YEAR, 2 * YEAR], indicators: { quote: [{ close: [100, null, 121] }] } }] } }),
} as Response);

describe('GET /api/historical-growth', () => {
  it('401s when signed out, before calling Yahoo', async () => {
    h.userId = null;
    const f = vi.fn(); vi.stubGlobal('fetch', f);
    const { GET } = await import('../route');
    expect((await GET(req('?ticker=AAPL'))).status).toBe(401);
    expect(f).not.toHaveBeenCalled();
  });

  it('400s without a ticker', async () => {
    const { GET } = await import('../route');
    expect((await GET(req(''))).status).toBe(400);
  });

  it('computes annualized price growth', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ok()));
    const { GET } = await import('../route');
    const res = await GET(req('?ticker=aapl&years=3'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ticker: 'AAPL', years: 3, actualYears: 2, startPrice: 100, endPrice: 121, annualGrowthPct: 10 });
  });

  it('serves a repeat request from cache, keyed by years', async () => {
    const f = vi.fn(async () => ok()); vi.stubGlobal('fetch', f);
    const { GET } = await import('../route');
    await GET(req('?ticker=AAPL&years=3')); await GET(req('?ticker=AAPL&years=3'));
    expect(f).toHaveBeenCalledTimes(1);
    await GET(req('?ticker=AAPL&years=5'));
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('maps failures to their existing statuses and does not cache them', async () => {
    const bad = vi.fn(async () => ({ ok: false, status: 429, json: async () => ({}) } as Response)); vi.stubGlobal('fetch', bad);
    const { GET } = await import('../route');
    const res = await GET(req('?ticker=AAPL'));
    expect(res.status).toBe(502);
    expect((await res.json()).error).toBe('Yahoo Finance request failed (429)');
    await GET(req('?ticker=AAPL'));
    expect(bad).toHaveBeenCalledTimes(2);

    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ chart: { result: [] } }) } as Response)));
    const none = await GET(req('?ticker=ZZZ'));
    expect(none.status).toBe(404);
    expect((await none.json()).error).toBe('No data returned for ticker');
  });

  it('500s with the message when fetch throws', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down'); }));
    const { GET } = await import('../route');
    const res = await GET(req('?ticker=AAPL'));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe('network down');
  });
});
