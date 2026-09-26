// app/api/wheel-plan/__tests__/route.test.ts
//
// WHEEL-SYSTEM-0001 (W1) -- the saved-plan route: signed-in and user-scoped, never trusts stored or sent data.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const requireSessionUserId = vi.fn();
const store = new Map<string, string>();
const redis = {
  get: vi.fn(async (k: string) => store.get(k) ?? null),
  set: vi.fn(async (k: string, v: string) => { store.set(k, v); return 'OK'; }),
  del: vi.fn(async (k: string) => { store.delete(k); return 1; }),
};

vi.mock('@/lib/ai/requireSession', () => ({ requireSessionUserId: () => requireSessionUserId() }));
vi.mock('@/lib/jobs/redis', () => ({ getRedis: () => redis }));

import { DELETE, GET, POST } from '../route';

const post = (body: unknown) => ({ json: async () => body }) as unknown as import('next/server').NextRequest;
const badJson = () => ({ json: async () => { throw new Error('bad'); } }) as unknown as import('next/server').NextRequest;
const req = {} as import('next/server').NextRequest;

beforeEach(() => {
  store.clear();
  requireSessionUserId.mockReset().mockResolvedValue('user-a');
  redis.get.mockClear(); redis.set.mockClear(); redis.del.mockClear();
});

describe('/api/wheel-plan', () => {
  it('requires a session on every method and touches nothing without one', async () => {
    requireSessionUserId.mockResolvedValue(null);
    expect((await GET(req)).status).toBe(401);
    expect((await POST(post({ overrides: {} }))).status).toBe(401);
    expect((await DELETE(req)).status).toBe(401);
    expect(redis.get).not.toHaveBeenCalled();
    expect(redis.set).not.toHaveBeenCalled();
    expect(redis.del).not.toHaveBeenCalled();
  });

  it('GET before any save returns the defaults', async () => {
    const res = await GET(req);
    expect(res.status).toBe(200);
    expect((await res.json()).plan).toMatchObject({ overrides: {}, wheelList: [] });
  });

  it('GET with malformed stored JSON returns the defaults, not a 500', async () => {
    store.set('wheel-plan:user-a', '{oops');
    const res = await GET(req);
    expect(res.status).toBe(200);
    expect((await res.json()).plan).toMatchObject({ overrides: {}, wheelList: [] });
  });

  it('saves and reads back through the signed-in user\'s own key only', async () => {
    const res = await POST(post({ overrides: { reserveBps: 500 }, wheelList: [{ symbol: 'XLF' }] }));
    expect(res.status).toBe(200);
    expect([...store.keys()]).toEqual(['wheel-plan:user-a']);
    const back = await (await GET(req)).json();
    expect(back.plan.overrides).toEqual({ reserveBps: 500 });
    expect(back.plan.wheelList).toEqual([{ symbol: 'XLF' }]);
  });

  it('a save of only one part keeps the other part as stored', async () => {
    await POST(post({ overrides: { reserveBps: 500 }, wheelList: [{ symbol: 'XLF' }] }));
    await POST(post({ wheelList: [{ symbol: 'XLE' }] }));
    const back = await (await GET(req)).json();
    expect(back.plan.overrides).toEqual({ reserveBps: 500 });
    expect(back.plan.wheelList).toEqual([{ symbol: 'XLE' }]);
  });

  it('an empty overrides object resets to the defaults', async () => {
    await POST(post({ overrides: { reserveBps: 500 } }));
    await POST(post({ overrides: {} }));
    expect((await (await GET(req)).json()).plan.overrides).toEqual({});
  });

  it('rejects invalid bodies with a 400 and saves nothing', async () => {
    for (const body of [{ overrides: { reserveBps: 'x' } }, { overrides: { nope: 1 } }, { extra: 1 }, { overrides: { reserveBps: 6000, spreadCapBps: 5000 } }, { wheelList: [{ symbol: 'XLF' }, { symbol: 'XLF' }] }]) {
      expect((await POST(post(body))).status).toBe(400);
    }
    expect((await POST(badJson())).status).toBe(400);
    expect(redis.set).not.toHaveBeenCalled();
  });

  it('a user id sent in the body is ignored', async () => {
    const res = await POST(post({ overrides: {}, userId: 'user-b' }));
    expect(res.status).toBe(400); // unknown field
    expect(store.size).toBe(0);
  });

  it('DELETE clears only this user\'s plan', async () => {
    store.set('wheel-plan:user-a', JSON.stringify({ overrides: { reserveBps: 500 } }));
    store.set('wheel-plan:user-b', JSON.stringify({ overrides: { reserveBps: 700 } }));
    expect((await DELETE(req)).status).toBe(200);
    expect(store.has('wheel-plan:user-a')).toBe(false);
    expect(store.has('wheel-plan:user-b')).toBe(true);
  });

  it('a Redis failure is a 500, not a crash', async () => {
    redis.get.mockRejectedValueOnce(new Error('down'));
    expect((await GET(req)).status).toBe(500);
  });
});
