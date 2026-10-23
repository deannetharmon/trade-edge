// app/api/market/__tests__/route.test.ts
//
// DATA-CACHE-0001: session required, symbol whitelist kept, cache hit, errors not cached.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createMemoryCacheStore, setSharedCacheStoreForTests } from '@/lib/cache/sharedCache';

const h = vi.hoisted(() => ({ userId: 'user-a' as string | null }));
vi.mock('@/lib/ai/requireSession', () => ({ requireSessionUserId: async () => h.userId }));

beforeEach(() => { h.userId = 'user-a'; setSharedCacheStoreForTests(createMemoryCacheStore()); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); setSharedCacheStoreForTests(null); });

const req = (q: string) => new NextRequest(`http://localhost/api/market${q}`);
const payload = { chart: { result: [{ meta: { regularMarketPrice: 18.2 } }] } };
const ok = () => ({ ok: true, status: 200, json: async () => payload } as Response);

describe('GET /api/market', () => {
  it('401s when signed out, before calling Yahoo', async () => {
    h.userId = null;
    const f = vi.fn(); vi.stubGlobal('fetch', f);
    const { GET } = await import('../route');
    expect((await GET(req('?symbol=^VIX'))).status).toBe(401);
    expect(f).not.toHaveBeenCalled();
  });

  it('400s without a symbol and 403s for a symbol outside the whitelist', async () => {
    const f = vi.fn(); vi.stubGlobal('fetch', f);
    const { GET } = await import('../route');
    expect((await GET(req(''))).status).toBe(400);
    expect((await GET(req('?symbol=AAPL'))).status).toBe(403);
    expect(f).not.toHaveBeenCalled();
  });

  it('passes the Yahoo JSON through unchanged', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ok()));
    const { GET } = await import('../route');
    const res = await GET(req('?symbol=^VIX&range=2d&interval=1d'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(payload);
  });

  it('caches per symbol, range, interval and pre/post, and serves repeats from cache', async () => {
    const f = vi.fn(async () => ok()); vi.stubGlobal('fetch', f);
    const { GET } = await import('../route');
    await GET(req('?symbol=^VIX&range=2d&interval=1d'));
    await GET(req('?symbol=^VIX&range=2d&interval=1d'));
    expect(f).toHaveBeenCalledTimes(1);
    await GET(req('?symbol=^VIX&range=5d&interval=1d'));
    await GET(req('?symbol=^VIX&range=2d&interval=1d&includePrePost=true'));
    expect(f).toHaveBeenCalledTimes(3);
  });

  it('maps a Yahoo error status and does not cache it', async () => {
    const f = vi.fn(async () => ({ ok: false, status: 503, json: async () => ({}) } as Response)); vi.stubGlobal('fetch', f);
    const { GET } = await import('../route');
    const res = await GET(req('?symbol=^VIX'));
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe('Yahoo Finance returned 503');
    await GET(req('?symbol=^VIX'));
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('500s with the message when fetch throws', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down'); }));
    const { GET } = await import('../route');
    const res = await GET(req('?symbol=^VIX'));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe('network down');
  });
});
