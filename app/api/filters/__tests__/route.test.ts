// app/api/filters/__tests__/route.test.ts
//
// SEC-0001 S3: filters previously used a global, non-user-scoped Redis key
// (filters:${strategy}) with no session check at all -- anyone who found
// the endpoint could read, overwrite, or delete Dean's saved presets. This
// confirms the session gate, the new user-scoped key, and the one-time
// migration of any existing data under the old key.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ userId: 'user-a' as string | null, store: new Map<string, string>() }));

vi.mock('@/lib/ai/requireSession', () => ({ requireSessionUserId: async () => h.userId }));

vi.mock('ioredis', () => ({
  default: class FakeRedis {
    async get(key: string) { return h.store.has(key) ? h.store.get(key)! : null; }
    async set(key: string, value: string) { h.store.set(key, value); }
    async del(key: string) { h.store.delete(key); }
    disconnect() {}
  },
}));

beforeEach(() => {
  h.userId = 'user-a';
  h.store.clear();
  process.env.REDIS_URL = 'redis://fake';
});
afterEach(() => { vi.restoreAllMocks(); });

function getReq(strategy: string) {
  return new Request(`http://localhost/api/filters?strategy=${strategy}`);
}
function writeReq(method: 'POST' | 'DELETE', body: unknown) {
  return new Request('http://localhost/api/filters', { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}

describe('GET /api/filters', () => {
  it('401s when signed out', async () => {
    h.userId = null;
    const { GET } = await import('../route');
    const res = await GET(getReq('bps'));
    expect(res.status).toBe(401);
  });

  it('reads from the new user-scoped key when present', async () => {
    h.store.set('filters:user-a:bps', JSON.stringify({ myFilter: ['AAPL'] }));
    const { GET } = await import('../route');
    const body = await (await GET(getReq('bps'))).json();
    expect(body.filters).toEqual({ myFilter: ['AAPL'] });
  });

  it('migrates data from the old global key to the new user-scoped key, then deletes the old key', async () => {
    h.store.set('filters:bps', JSON.stringify({ legacyFilter: ['MSFT'] }));
    const { GET } = await import('../route');
    const body = await (await GET(getReq('bps'))).json();
    expect(body.filters).toEqual({ legacyFilter: ['MSFT'] });
    expect(h.store.get('filters:user-a:bps')).toBe(JSON.stringify({ legacyFilter: ['MSFT'] }));
    expect(h.store.has('filters:bps')).toBe(false);
  });

  it('does not re-migrate once the new key already has data, even if a stale old key exists', async () => {
    h.store.set('filters:user-a:bps', JSON.stringify({ current: ['NVDA'] }));
    h.store.set('filters:bps', JSON.stringify({ stale: ['OLD'] }));
    const { GET } = await import('../route');
    const body = await (await GET(getReq('bps'))).json();
    expect(body.filters).toEqual({ current: ['NVDA'] });
  });

  it('returns an empty object for a fresh user with no data under either key', async () => {
    const { GET } = await import('../route');
    const body = await (await GET(getReq('bps'))).json();
    expect(body.filters).toEqual({});
  });
});

describe('POST /api/filters', () => {
  it('401s when signed out', async () => {
    h.userId = null;
    const { POST } = await import('../route');
    const res = await POST(writeReq('POST', { strategy: 'bps', name: 'x', tickers: ['AAPL'] }));
    expect(res.status).toBe(401);
  });

  it('saves under the new user-scoped key and migrates any legacy data first', async () => {
    h.store.set('filters:bps', JSON.stringify({ legacyFilter: ['MSFT'] }));
    const { POST } = await import('../route');
    const res = await POST(writeReq('POST', { strategy: 'bps', name: 'newOne', tickers: ['AAPL'] }));
    expect((await res.json()).success).toBe(true);
    const saved = JSON.parse(h.store.get('filters:user-a:bps')!);
    expect(saved).toEqual({ legacyFilter: ['MSFT'], newOne: ['AAPL'] });
    expect(h.store.has('filters:bps')).toBe(false);
  });

  it('reports a conflict without replace, for a name that already exists', async () => {
    h.store.set('filters:user-a:bps', JSON.stringify({ existing: ['AAPL'] }));
    const { POST } = await import('../route');
    const res = await POST(writeReq('POST', { strategy: 'bps', name: 'existing', tickers: ['MSFT'] }));
    const body = await res.json();
    expect(body.conflict).toBe(true);
  });
});

describe('DELETE /api/filters', () => {
  it('401s when signed out', async () => {
    h.userId = null;
    const { DELETE } = await import('../route');
    const res = await DELETE(writeReq('DELETE', { strategy: 'bps', name: 'x' }));
    expect(res.status).toBe(401);
  });

  it('deletes the named preset from the user-scoped key', async () => {
    h.store.set('filters:user-a:bps', JSON.stringify({ a: ['AAPL'], b: ['MSFT'] }));
    const { DELETE } = await import('../route');
    await DELETE(writeReq('DELETE', { strategy: 'bps', name: 'a' }));
    expect(JSON.parse(h.store.get('filters:user-a:bps')!)).toEqual({ b: ['MSFT'] });
  });
});
