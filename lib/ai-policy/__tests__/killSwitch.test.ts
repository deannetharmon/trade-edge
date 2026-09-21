// lib/ai-policy/__tests__/killSwitch.test.ts
import { describe, expect, it } from 'vitest';
import { KILL_GLOBAL_KEY, checkKillSwitch, killRouteKey } from '../killSwitch';
import { FakeRedis } from '../fixtures/fakeRedis';

describe('kill switches', () => {
  it('is not killed when no key is set', async () => {
    expect(await checkKillSwitch(new FakeRedis(), 'scan_summary')).toEqual({ killed: false, cause: null });
  });

  it('global key kills every route; route key kills only its route', async () => {
    const redis = new FakeRedis();
    await redis.set(killRouteKey('grounded_chat'), '1');
    expect((await checkKillSwitch(redis, 'grounded_chat')).cause).toBe('ROUTE');
    expect((await checkKillSwitch(redis, 'scan_summary')).killed).toBe(false);
    await redis.set(KILL_GLOBAL_KEY, 'true');
    expect((await checkKillSwitch(redis, 'scan_summary')).cause).toBe('GLOBAL');
  });

  it('only an explicit 0/false/off lifts a kill key; any other value kills', async () => {
    const redis = new FakeRedis();
    for (const lifted of ['0', 'false', 'OFF']) {
      await redis.set(KILL_GLOBAL_KEY, lifted);
      expect((await checkKillSwitch(redis, 'scan_summary')).killed).toBe(false);
    }
    for (const kills of ['1', 'on', 'yes', 'anything']) {
      await redis.set(KILL_GLOBAL_KEY, kills);
      expect((await checkKillSwitch(redis, 'scan_summary')).killed).toBe(true);
    }
  });

  it('a Redis error is treated as off (unavailable)', async () => {
    const redis = new FakeRedis();
    redis.failAll = true;
    expect(await checkKillSwitch(redis, 'scan_summary')).toEqual({ killed: true, cause: 'ERROR' });
  });
});
