// lib/ai-policy/__tests__/circuitBreaker.test.ts
import { describe, expect, it } from 'vitest';
import { FAILURE_THRESHOLD, OPEN_MILLIS, admit, recordFailure, recordSuccess, releaseProbe } from '../circuitBreaker';
import { FakeRedis } from '../fixtures/fakeRedis';

const T0 = 1_800_000_000_000;

async function tripBreaker(redis: FakeRedis): Promise<void> {
  for (let i = 0; i < FAILURE_THRESHOLD; i += 1) await recordFailure(redis, 'economy', T0, false);
}

describe('circuit breaker', () => {
  it('stays closed below the threshold', async () => {
    const redis = new FakeRedis();
    for (let i = 0; i < FAILURE_THRESHOLD - 1; i += 1) await recordFailure(redis, 'economy', T0, false);
    expect(await admit(redis, 'economy', T0)).toEqual({ admitted: true, probe: false });
  });

  it('opens at 5 failures and rejects during the open period', async () => {
    const redis = new FakeRedis();
    await tripBreaker(redis);
    expect(await admit(redis, 'economy', T0 + 1000)).toEqual({ admitted: false });
    expect(await admit(redis, 'economy', T0 + OPEN_MILLIS - 1)).toEqual({ admitted: false });
  });

  it('tiers are independent', async () => {
    const redis = new FakeRedis();
    await tripBreaker(redis);
    expect(await admit(redis, 'reasoning', T0 + 1000)).toEqual({ admitted: true, probe: false });
  });

  it('after the open period exactly one half-open probe is admitted', async () => {
    const redis = new FakeRedis();
    await tripBreaker(redis);
    const results = await Promise.all(Array.from({ length: 10 }, () => admit(redis, 'economy', T0 + OPEN_MILLIS + 1)));
    expect(results.filter((r) => r.admitted)).toHaveLength(1);
    expect(results.find((r) => r.admitted)).toEqual({ admitted: true, probe: true });
  });

  it('a successful probe closes the breaker', async () => {
    const redis = new FakeRedis();
    await tripBreaker(redis);
    await admit(redis, 'economy', T0 + OPEN_MILLIS + 1);
    await recordSuccess(redis, 'economy', true);
    expect(await admit(redis, 'economy', T0 + OPEN_MILLIS + 2)).toEqual({ admitted: true, probe: false });
  });

  it('a failed probe re-opens it for another period', async () => {
    const redis = new FakeRedis();
    await tripBreaker(redis);
    const t = T0 + OPEN_MILLIS + 1;
    await admit(redis, 'economy', t);
    await recordFailure(redis, 'economy', t, true);
    expect(await admit(redis, 'economy', t + 1000)).toEqual({ admitted: false });
    expect(await admit(redis, 'economy', t + OPEN_MILLIS + 1)).toEqual({ admitted: true, probe: true });
  });

  it('an abandoned probe can be released so another may run', async () => {
    const redis = new FakeRedis();
    await tripBreaker(redis);
    const t = T0 + OPEN_MILLIS + 1;
    await admit(redis, 'economy', t);
    expect((await admit(redis, 'economy', t)).admitted).toBe(false);
    await releaseProbe(redis, 'economy');
    expect((await admit(redis, 'economy', t)).admitted).toBe(true);
  });

  it('fails closed on a Redis error', async () => {
    const redis = new FakeRedis();
    redis.failAll = true;
    expect(await admit(redis, 'economy', T0)).toEqual({ admitted: false });
  });
});
