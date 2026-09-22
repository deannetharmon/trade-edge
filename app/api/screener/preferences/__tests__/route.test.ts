// app/api/screener/preferences/__tests__/route.test.ts

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeRedis } from '@/lib/ai-policy/fixtures/fakeRedis';

const h = vi.hoisted(() => ({ redis: null as unknown, userId: 'user-a' as string | null }));
vi.mock('@/lib/jobs/redis', () => ({ getRedis: () => h.redis }));
vi.mock('@/lib/ai/requireSession', () => ({ requireSessionUserId: async () => h.userId }));

let redis: FakeRedis;
beforeEach(() => {
  redis = new FakeRedis();
  h.redis = redis;
  h.userId = 'user-a';
});
afterEach(() => { vi.restoreAllMocks(); });

const post = (body: unknown) => new Request('http://localhost/api/screener/preferences', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

describe('GET /api/screener/preferences', () => {
  it('401 when signed out', async () => {
    h.userId = null;
    const { GET } = await import('../route');
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it('returns the empty defaults for a fresh user', async () => {
    const { GET } = await import('../route');
    const res = await GET();
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.preferences).toMatchObject({ oiMin: null, delta: {}, defaultMode: {} });
  });

  it('returns previously saved preferences', async () => {
    await redis.set('screener:prefs:user-a', JSON.stringify({ oiMin: 100, delta: { csp: { min: 0.15, max: 0.25 } }, defaultMode: {} }));
    const { GET } = await import('../route');
    const body = await (await GET()).json();
    expect(body.preferences).toMatchObject({ oiMin: 100, delta: { csp: { min: 0.15, max: 0.25 } } });
  });
});

describe('POST /api/screener/preferences', () => {
  it('401 when signed out, before touching Redis', async () => {
    h.userId = null;
    const { POST } = await import('../route');
    const res = await POST(post({ oiMin: 100 }));
    expect(res.status).toBe(401);
    expect(redis.store.size).toBe(0);
  });

  it('saves and returns the merged preferences', async () => {
    const { POST } = await import('../route');
    const res = await POST(post({ oiMin: 100, popMin: 70 }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.preferences).toMatchObject({ oiMin: 100, popMin: 70 });
  });

  it('422 for a non-object body, and nothing is written', async () => {
    const { POST } = await import('../route');
    const res = await POST(post('not an object'));
    expect(res.status).toBe(422);
    expect(redis.store.size).toBe(0);
  });

  it('400 for invalid JSON', async () => {
    const { POST } = await import('../route');
    const res = await POST(new Request('http://localhost/api/screener/preferences', { method: 'POST', body: 'not json' }));
    expect(res.status).toBe(400);
  });

  it('one user cannot write another user\'s preferences', async () => {
    const { POST } = await import('../route');
    h.userId = 'user-a';
    await POST(post({ oiMin: 100 }));
    h.userId = 'user-b';
    await POST(post({ oiMin: 999 }));
    expect(JSON.parse((await redis.get('screener:prefs:user-a'))!).oiMin).toBe(100);
    expect(JSON.parse((await redis.get('screener:prefs:user-b'))!).oiMin).toBe(999);
  });

  it('a Redis failure returns a neutral 500, not a stack trace', async () => {
    redis.failAll = true;
    const { POST } = await import('../route');
    const res = await POST(post({ oiMin: 100 }));
    const body = await res.json();
    expect(res.status).toBe(500);
    expect(JSON.stringify(body)).not.toMatch(/at \/|node_modules|Error:/);
  });
});
