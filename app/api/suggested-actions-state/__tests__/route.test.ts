// app/api/suggested-actions-state/__tests__/route.test.ts

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ userId: 'user-a' as string | null, store: new Map<string, string>(), fail: false }));

vi.mock('@/lib/ai/requireSession', () => ({ requireSessionUserId: async () => h.userId }));

vi.mock('ioredis', () => ({
  default: class FakeRedis {
    async get(key: string) { if (h.fail) throw new Error('redis down'); return h.store.has(key) ? h.store.get(key)! : null; }
    async set(key: string, value: string) { if (h.fail) throw new Error('redis down'); h.store.set(key, value); }
    disconnect() {}
  },
}));

beforeEach(() => {
  h.userId = 'user-a';
  h.store.clear();
  h.fail = false;
  process.env.REDIS_URL = 'redis://fake';
});
afterEach(() => { vi.restoreAllMocks(); });

function post(body: unknown) {
  return new Request('http://localhost/api/suggested-actions-state', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}

describe('/api/suggested-actions-state', () => {
  it('401s when signed out, for both GET and POST', async () => {
    h.userId = null;
    const { GET, POST } = await import('../route');
    expect((await GET()).status).toBe(401);
    expect((await POST(post({ armed: {} }))).status).toBe(401);
  });

  it('round-trips the armed map under a per-user key', async () => {
    const { GET, POST } = await import('../route');
    const armed = { 'pos-1': '2026-10-02T20:00:00.000Z' };
    expect((await POST(post({ armed }))).status).toBe(200);
    expect(h.store.get('suggested-actions:user-a')).toBe(JSON.stringify(armed));
    expect(await (await GET()).json()).toEqual({ armed });
    h.userId = 'user-b';
    expect(await (await GET()).json()).toEqual({ armed: {} });
  });

  it('a later save replaces the map, which is how released and vanished positions are pruned', async () => {
    const { GET, POST } = await import('../route');
    await POST(post({ armed: { a: '2026-10-02T20:00:00.000Z', b: '2026-10-02T20:00:00.000Z' } }));
    await POST(post({ armed: { a: '2026-10-02T20:00:00.000Z' } }));
    expect((await (await GET()).json()).armed).toEqual({ a: '2026-10-02T20:00:00.000Z' });
  });

  it('rejects a malformed body without writing', async () => {
    const { POST } = await import('../route');
    for (const body of [{}, { armed: [] }, { armed: { a: 5 } }, { armed: { a: 'not a date' } }, { armed: null }]) {
      expect((await POST(post(body))).status).toBe(400);
    }
    expect(h.store.size).toBe(0);
  });

  it('treats a corrupt stored value as empty state', async () => {
    h.store.set('suggested-actions:user-a', JSON.stringify(['nope']));
    const { GET } = await import('../route');
    expect(await (await GET()).json()).toEqual({ armed: {} });
  });

  it('a Redis failure is a 500 the client can ignore', async () => {
    h.fail = true;
    const { GET } = await import('../route');
    expect((await GET()).status).toBe(500);
  });
});
