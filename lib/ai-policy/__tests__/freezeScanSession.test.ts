// lib/ai-policy/__tests__/freezeScanSession.test.ts
import { describe, expect, it } from 'vitest';
import { FREEZE_HOURLY_LIMIT, freezeCountKey, freezeKey, freezeScanSession } from '../freezeScanSession';
import type { FreezeDeps } from '../freezeScanSession';
import { getInput } from '../inputStore';
import { KILL_GLOBAL_KEY, killRouteKey } from '../killSwitch';
import { FakeRedis } from '../fixtures/fakeRedis';
import { NOW, OTHER_USER, TEST_ENV, USER } from '../fixtures/testRoute';
import { cloneSession, deepFreeze, makeSession } from '../builders/testing/scanSessionFixture';

const IDEM = 'freeze-key-0123456789';

function setup(env: Record<string, string | undefined> = {}) {
  const redis = new FakeRedis();
  redis.clock = () => Date.now();
  const deps: FreezeDeps = { env: { ...TEST_ENV, ...env }, redis, now: () => Date.now() };
  return { redis, deps, freeze: (over: Partial<Parameters<typeof freezeScanSession>[0]> = {}) => freezeScanSession({ userId: USER, session: makeSession(), idempotencyKey: IDEM, ...over }, deps) };
}

describe('freezeScanSession', () => {
  it('freezes a complete session: returns an opaque id, the hash and the time, and stores an immutable encrypted input', async () => {
    const s = setup();
    const result = await s.freeze();
    if (result.status !== 'frozen') throw new Error(`expected frozen, got ${JSON.stringify(result)}`);
    expect(result.analysisInputId).toMatch(/^[0-9a-f-]{36}$/);
    expect(result.payloadHash).toMatch(/^[0-9a-f]{64}$/);
    const stored = await getInput(s.redis, USER, result.analysisInputId, s.deps.env);
    expect(stored.ok && stored.input).toMatchObject({ route: 'scan_summary', trust: 'client_attested', payloadHash: result.payloadHash });
    expect(JSON.stringify(Array.from(s.redis.store.values()))).not.toContain('"symbolsEvaluated"');
  });

  it('acceptance 2: another user asking for the input gets the identical NOT_FOUND as a random id', async () => {
    const s = setup();
    const result = await s.freeze();
    if (result.status !== 'frozen') throw new Error('expected frozen');
    const foreign = await getInput(s.redis, OTHER_USER, result.analysisInputId, s.deps.env);
    const random = await getInput(s.redis, USER, '11111111-1111-4111-8111-111111111111', s.deps.env);
    expect(foreign).toEqual({ ok: false, reason: 'NOT_FOUND' });
    expect(random).toEqual(foreign);
  });

  it('is idempotent: the same key returns the same input and stores one', async () => {
    const s = setup();
    const first = await s.freeze();
    const second = await s.freeze();
    expect(second).toEqual(first);
    expect(Array.from(s.redis.store.keys()).filter((k) => k.startsWith('ai-policy:input:'))).toHaveLength(1);
  });

  it('an in-flight claim is the neutral RATE_LIMIT', async () => {
    const s = setup();
    await s.redis.set(freezeKey(USER, IDEM), 'pending', 'EX', 90);
    expect(await s.freeze()).toEqual({ status: 'unavailable', reason: 'RATE_LIMIT' });
  });

  it.each([['error'], ['stopped']] as const)('rejects a %s session, stores nothing, and frees the key for a retry', async (status) => {
    const s = setup();
    expect(await s.freeze({ session: makeSession({ status }) })).toEqual({ status: 'unavailable', reason: 'INPUT_INVALID' });
    expect(Array.from(s.redis.store.keys()).filter((k) => k.startsWith('ai-policy:input:'))).toHaveLength(0);
    expect((await s.freeze()).status).toBe('frozen');
  });

  it('accepts a deep-frozen session and does not mutate it', async () => {
    const s = setup();
    const session = deepFreeze(cloneSession(makeSession()));
    const before = JSON.stringify(session);
    expect((await s.freeze({ session })).status).toBe('frozen');
    expect(JSON.stringify(session)).toBe(before);
  });

  describe('dark by default and fail closed', () => {
    it.each([
      ['global flag off', { AI_POLICY_ENABLED: undefined }, 'FLAG_OFF'],
      ['both scan route flags off', { AI_POLICY_SCAN_SUMMARY_ENABLED: undefined, AI_POLICY_GROUNDED_CHAT_ENABLED: undefined }, 'FLAG_OFF'],
      ['no encryption key', { AI_POLICY_ARTIFACT_KEY: undefined }, 'GOVERNANCE'],
      ['no scope secret', { AI_POLICY_SCOPE_SECRET: undefined }, 'GOVERNANCE'],
    ])('%s', async (_n, env, reason) => {
      const s = setup(env);
      expect(await s.freeze()).toEqual({ status: 'unavailable', reason });
      expect(Array.from(s.redis.store.keys()).filter((k) => k.startsWith('ai-policy:input:'))).toHaveLength(0);
    });

    it('the flag alone for one route is enough to freeze', async () => {
      expect((await setup({ AI_POLICY_GROUNDED_CHAT_ENABLED: undefined }).freeze()).status).toBe('frozen');
    });

    it('a global kill switch, or both route kill switches, stop it; one route kill does not', async () => {
      const a = setup();
      await a.redis.set(KILL_GLOBAL_KEY, '1');
      expect(await a.freeze()).toEqual({ status: 'unavailable', reason: 'KILL_SWITCH' });
      const b = setup();
      await b.redis.set(killRouteKey('scan_summary'), '1');
      expect((await b.freeze()).status).toBe('frozen');
      await b.redis.set(killRouteKey('grounded_chat'), '1');
      expect(await b.freeze({ idempotencyKey: 'freeze-key-other-00001' })).toEqual({ status: 'unavailable', reason: 'KILL_SWITCH' });
    });

    it('refuses a bad idempotency key or user id', async () => {
      const s = setup();
      expect(await s.freeze({ idempotencyKey: 'short' })).toEqual({ status: 'unavailable', reason: 'INPUT_INVALID' });
      expect(await s.freeze({ userId: 'a:b' })).toEqual({ status: 'unavailable', reason: 'INPUT_INVALID' });
    });

    it('never throws when Redis fails, and frees its claim', async () => {
      const s = setup();
      const originalSet = s.redis.set.bind(s.redis);
      let n = 0;
      s.redis.set = async (key: string, value: string, ...args: Array<string | number>) => {
        if (key.startsWith('ai-policy:input:')) throw new Error('redis exploded');
        n += 1;
        return originalSet(key, value, ...args);
      };
      expect(await s.freeze()).toEqual({ status: 'unavailable', reason: 'PROVIDER_ERROR' });
      expect(n).toBeGreaterThan(0);
      expect(await s.redis.get(freezeKey(USER, IDEM))).toBeNull();
    });

    it('Redis down from the start is a neutral unavailable, not a throw', async () => {
      const s = setup();
      s.redis.failAll = true;
      expect((await s.freeze()).status).toBe('unavailable');
    });
  });

  it('caps stored snapshots per user per hour', async () => {
    const s = setup();
    await s.redis.set(freezeCountKey(USER, Date.now()), String(FREEZE_HOURLY_LIMIT));
    expect(await s.freeze()).toEqual({ status: 'unavailable', reason: 'RATE_LIMIT' });
    expect(await s.redis.get(freezeKey(USER, IDEM))).toBeNull();
    void NOW;
  });
});
