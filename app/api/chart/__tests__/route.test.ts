// app/api/chart/__tests__/route.test.ts
//
// DATA-CACHE-0001: session required, validation, success shape, cache hit, errors not cached.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createMemoryCacheStore, setSharedCacheStoreForTests } from '@/lib/cache/sharedCache';

const h = vi.hoisted(() => ({ userId: 'user-a' as string | null }));
vi.mock('@/lib/ai/requireSession', () => ({ requireSessionUserId: async () => h.userId }));

beforeEach(() => { h.userId = 'user-a'; setSharedCacheStoreForTests(createMemoryCacheStore()); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); setSharedCacheStoreForTests(null); });

const req = (q: string) => new NextRequest(`http://localhost/api/chart${q}`);

function yahooOk() {
  return {
    ok: true, status: 200,
    json: async () => ({ chart: { result: [{ timestamp: [1, 2, 3], indicators: { quote: [{ open: [1, 2, null], high: [2, 3, 4], low: [0, 1, 2], close: [1.5, 2.5, 3.5] }] } }] } }),
  } as Response;
}

describe('GET /api/chart', () => {
  it('401s when signed out, before calling Yahoo', async () => {
    h.userId = null;
    const f = vi.fn(); vi.stubGlobal('fetch', f);
    const { GET } = await import('../route');
    expect((await GET(req('?symbol=AAPL'))).status).toBe(401);
    expect(f).not.toHaveBeenCalled();
  });

  it('400s when symbol is missing', async () => {
    const { GET } = await import('../route');
    expect((await GET(req(''))).status).toBe(400);
  });

  it('returns bars, dropping any with a null OHLC value', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => yahooOk()));
    const { GET } = await import('../route');
    const res = await GET(req('?symbol=AAPL'));
    expect(res.status).toBe(200);
    expect((await res.json()).bars).toEqual([{ t: 1, o: 1, h: 2, l: 0, c: 1.5 }, { t: 2, o: 2, h: 3, l: 1, c: 2.5 }]);
  });

  it('serves a repeat request from cache', async () => {
    const f = vi.fn(async () => yahooOk()); vi.stubGlobal('fetch', f);
    const { GET } = await import('../route');
    await GET(req('?symbol=AAPL')); await GET(req('?symbol=aapl'));
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('maps a Yahoo error status and does not cache it', async () => {
    const f = vi.fn(async () => ({ ok: false, status: 429, json: async () => ({}) } as Response)); vi.stubGlobal('fetch', f);
    const { GET } = await import('../route');
    const res = await GET(req('?symbol=AAPL'));
    expect(res.status).toBe(429);
    expect((await res.json()).error).toBe('Yahoo Finance returned 429');
    await GET(req('?symbol=AAPL'));
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('404s on no result and does not cache an empty bar list', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ chart: { result: [] } }) } as Response)));
    const { GET } = await import('../route');
    expect((await GET(req('?symbol=BAD'))).status).toBe(404);
    const f = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ chart: { result: [{ timestamp: [], indicators: { quote: [{}] } }] } }) } as Response));
    vi.stubGlobal('fetch', f);
    expect((await (await GET(req('?symbol=EMPTY'))).json()).bars).toEqual([]);
    await GET(req('?symbol=EMPTY'));
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('500s with the message when fetch throws', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down'); }));
    const { GET } = await import('../route');
    const res = await GET(req('?symbol=AAPL'));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe('network down');
  });
});
