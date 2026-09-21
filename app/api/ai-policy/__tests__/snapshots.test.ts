// app/api/ai-policy/__tests__/snapshots.test.ts
//
// POST /api/ai-policy/snapshots: auth first, strict body, freeze rules, idempotency, dark by default, neutral failures.
// Follows the pattern of app/api/paper-trading/__tests__/security.test.ts.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeRedis } from '@/lib/ai-policy/fixtures/fakeRedis';
import { cloneSession, makeSession } from '@/lib/ai-policy/builders/testing/scanSessionFixture';
import { KEY_A, applyEnv, expectNeutralBody, post, stubProvider } from './support';

const h = vi.hoisted(() => ({ redis: null as unknown, userId: 'user-a' as string | null }));
vi.mock('@/lib/jobs/redis', () => ({ getRedis: () => h.redis }));
vi.mock('@/lib/ai/requireSession', () => ({ requireSessionUserId: async () => h.userId }));

let restoreEnv: () => void;
let redis: FakeRedis;
beforeEach(() => {
  redis = new FakeRedis();
  h.redis = redis;
  h.userId = 'user-a';
  restoreEnv = applyEnv();
});
afterEach(() => {
  restoreEnv();
  vi.unstubAllGlobals();
});

const call = async (body: unknown, raw = false) => {
  const { POST } = await import('../snapshots/route');
  const res = await POST(post('/api/ai-policy/snapshots', body, raw));
  return { res, body: (await res.json()) as Record<string, unknown> };
};
const good = (over: Record<string, unknown> = {}) => ({ kind: 'scan_session', session: makeSession(), idempotencyKey: KEY_A, ...over });
const storedInputs = (): number => Array.from(redis.store.keys()).filter((k) => k.startsWith('ai-policy:input:')).length;

describe('route configuration', () => {
  it('runs on Node, is dynamic, and has a 60 s limit', async () => {
    const mod = await import('../snapshots/route');
    expect([mod.runtime, mod.dynamic, mod.maxDuration]).toEqual(['nodejs', 'force-dynamic', 60]);
  });
});

describe('authentication', () => {
  it('returns 401 before reading the body or touching Redis or the provider', async () => {
    h.userId = null;
    const provider = stubProvider('{}');
    const { res, body } = await call('not even json', true);
    expect(res.status).toBe(401);
    expect(body).toEqual({ status: 'unauthorized' });
    expect(redis.store.size).toBe(0);
    expect(provider).not.toHaveBeenCalled();
  });

  it('a user id in the body can never select another account: it is an unknown key and is refused', async () => {
    const { res } = await call(good({ userId: 'someone-else' }));
    expect(res.status).toBe(422);
    expect(storedInputs()).toBe(0);
  });
});

describe('freeze', () => {
  it('freezes a complete session and returns only an opaque id, the hash, and the time', async () => {
    const { res, body } = await call(good());
    expect(res.status).toBe(200);
    expect(body.status).toBe('frozen');
    expect(Object.keys(body).sort()).toEqual(['analysisInputId', 'createdAt', 'payloadHash', 'status']);
    expect(body.analysisInputId).toMatch(/^[0-9a-f-]{36}$/);
    expect(storedInputs()).toBe(1);
  });

  it('is idempotent on the key', async () => {
    const first = await call(good());
    const second = await call(good());
    expect(second.body).toEqual(first.body);
    expect(storedInputs()).toBe(1);
  });

  it.each([
    ['an error session', () => makeSession({ status: 'error' })],
    ['a stopped session', () => makeSession({ status: 'stopped' })],
    ['a garbage session', () => ({ nope: true })],
    ['a schema-mismatched session', () => ({ ...cloneSession(makeSession()), schemaVersion: 3 })],
    ['a DTE-mismatched candidate', () => { const s = cloneSession(makeSession()); (s.results[0].bestCandidate as { dte: number }).dte = 200; return s; }],
  ])('rejects %s with 422 INPUT_INVALID and stores nothing', async (_n, make) => {
    const { res, body } = await call(good({ session: make() }));
    expect(res.status).toBe(422);
    expect(body).toEqual({ status: 'unavailable', reason: 'INPUT_INVALID', artifactId: null });
    expect(storedInputs()).toBe(0);
  });

  it('rejects an oversize body with 413', async () => {
    const { res, body } = await call(JSON.stringify({ ...good(), padding: 'x'.repeat(2_100_000) }), true);
    expect(res.status).toBe(413);
    expectNeutralBody(body);
    expect(storedInputs()).toBe(0);
  });

  it.each([
    ['invalid JSON', 'not json'], ['a wrong kind', JSON.stringify(good({ kind: 'position' }))], ['a missing key', JSON.stringify({ kind: 'scan_session', session: makeSession() })],
    ['an unknown key', JSON.stringify(good({ assistantMessage: 'x' }))], ['a non-string idempotency key', JSON.stringify(good({ idempotencyKey: 5 }))],
    ['a bad idempotency key', JSON.stringify(good({ idempotencyKey: 'short' }))],
  ])('refuses %s with 422', async (_n, raw) => {
    const { res, body } = await call(raw, true);
    expect(res.status).toBe(422);
    expectNeutralBody(body);
  });
});

describe('dark by default, fail closed, neutral bodies', () => {
  it('flags off: 503 FLAG_OFF and nothing stored', async () => {
    restoreEnv();
    restoreEnv = applyEnv({ AI_POLICY_ENABLED: undefined });
    const { res, body } = await call(good());
    expect(res.status).toBe(503);
    expect(body).toEqual({ status: 'unavailable', reason: 'FLAG_OFF', artifactId: null });
    expect(redis.store.size).toBe(0);
  });

  it('a kill switch: 503 KILL_SWITCH', async () => {
    await redis.set('ai-policy:kill:global', '1');
    const { res, body } = await call(good());
    expect([res.status, body.reason]).toEqual([503, 'KILL_SWITCH']);
  });

  it('Redis down: a neutral 503, never a stack', async () => {
    redis.failAll = true;
    const { res, body } = await call(good());
    expect(res.status).toBe(503);
    expectNeutralBody(body);
  });

  it('never echoes client content back', async () => {
    const hostile = { ...cloneSession(makeSession({ status: 'error' })), note: 'SECRET-CLIENT-TEXT' };
    const { body } = await call(good({ session: hostile }));
    expect(JSON.stringify(body)).not.toContain('SECRET-CLIENT-TEXT');
  });
});
