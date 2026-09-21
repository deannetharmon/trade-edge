// lib/ai-policy/__tests__/budget.test.ts
import { describe, expect, it } from 'vitest';
import { InMemoryBudgetStore, RESERVE_SCRIPT, RedisBudgetStore, budgetKeys } from '../budget';
import type { BudgetLimits } from '../budget';
import { FakeRedis } from '../fixtures/fakeRedis';
import { NOW } from '../fixtures/testRoute';

const limits = (over: Partial<BudgetLimits> = {}): BudgetLimits => ({ routeHourlyLimit: 5, userMonthlyMicros: 1_000_000, globalDailyMicros: 10_000_000, ...over });
const base = { userId: 'u1', route: 'scan_summary' as const, estimateMicros: 10_000, nowMs: NOW };

describe('BudgetStore contract (in-memory)', () => {
  it('N concurrent reserve() calls never exceed the hourly limit', async () => {
    const store = new InMemoryBudgetStore();
    const results = await Promise.all(Array.from({ length: 25 }, () => store.reserve({ ...base, limits: limits() })));
    expect(results.filter((r) => r.ok)).toHaveLength(5);
    expect(results.filter((r) => !r.ok && r.reason === 'RATE_LIMIT')).toHaveLength(20);
  });

  it('never exceeds the user monthly USD allowance', async () => {
    const store = new InMemoryBudgetStore();
    const results = await Promise.all(Array.from({ length: 25 }, () => store.reserve({ ...base, limits: limits({ routeHourlyLimit: 1000, userMonthlyMicros: 50_000 }) })));
    expect(results.filter((r) => r.ok)).toHaveLength(5);
    expect(results.filter((r) => !r.ok && r.reason === 'BUDGET')).toHaveLength(20);
    expect(store.get(budgetKeys('u1', 'scan_summary', NOW).monthKey)).toBe(50_000);
  });

  it('never exceeds the global daily allowance across users', async () => {
    const store = new InMemoryBudgetStore();
    const l = limits({ routeHourlyLimit: 1000, userMonthlyMicros: 10_000_000, globalDailyMicros: 30_000 });
    const results = await Promise.all(Array.from({ length: 12 }, (_, i) => store.reserve({ ...base, userId: `user-${i % 4}`, limits: l })));
    expect(results.filter((r) => r.ok)).toHaveLength(3);
  });

  it('reconcile() releases the unused reserve and records an overrun', async () => {
    const store = new InMemoryBudgetStore();
    const first = await store.reserve({ ...base, limits: limits() });
    if (!first.ok) throw new Error('expected reservation');
    const { monthKey, dayKey } = first.reservation;
    await store.reconcile(first.reservation, 4_000);
    expect(store.get(monthKey)).toBe(4_000);
    expect(store.get(dayKey)).toBe(4_000);
    const second = await store.reserve({ ...base, limits: limits() });
    if (!second.ok) throw new Error('expected reservation');
    await store.reconcile(second.reservation, 12_000);
    expect(store.get(monthKey)).toBe(16_000);
  });

  it('the hourly window expires: a new hour starts a new count', async () => {
    const store = new InMemoryBudgetStore();
    for (let i = 0; i < 5; i += 1) await store.reserve({ ...base, limits: limits() });
    expect((await store.reserve({ ...base, limits: limits() })).ok).toBe(false);
    const nextHour = await store.reserve({ ...base, nowMs: NOW + 3_600_000, limits: limits() });
    expect(nextHour.ok).toBe(true);
  });

  it('hourly limits are per user and per route', async () => {
    const store = new InMemoryBudgetStore();
    for (let i = 0; i < 5; i += 1) await store.reserve({ ...base, limits: limits() });
    expect((await store.reserve({ ...base, userId: 'u2', limits: limits() })).ok).toBe(true);
    expect((await store.reserve({ ...base, route: 'grounded_chat', limits: limits() })).ok).toBe(true);
  });
});

describe('RedisBudgetStore', () => {
  it('runs the check-and-reserve as ONE script call and maps its verdicts', async () => {
    const calls: Array<{ script: string; numKeys: number }> = [];
    const verdicts = ['OK', 'RATE_LIMIT', 'BUDGET'];
    const redis = new FakeRedis();
    redis.eval = (async (script: string, numKeys: number) => {
      calls.push({ script, numKeys });
      return verdicts.shift();
    }) as FakeRedis['eval'];
    const store = new RedisBudgetStore(redis);
    expect((await store.reserve({ ...base, limits: limits() })).ok).toBe(true);
    expect(await store.reserve({ ...base, limits: limits() })).toEqual({ ok: false, reason: 'RATE_LIMIT' });
    expect(await store.reserve({ ...base, limits: limits() })).toEqual({ ok: false, reason: 'BUDGET' });
    expect(calls.every((c) => c.script === RESERVE_SCRIPT && c.numKeys === 3)).toBe(true);
  });

  it('a Redis error propagates so the gateway fails closed', async () => {
    const redis = new FakeRedis();
    await expect(new RedisBudgetStore(redis).reserve({ ...base, limits: limits() })).rejects.toThrow();
  });

  it('reconcile adjusts the month and day counters by the difference', async () => {
    const redis = new FakeRedis();
    const store = new RedisBudgetStore(redis);
    const reservation = { id: 'r', reservedMicros: 10_000, monthKey: 'm', dayKey: 'd' };
    await redis.set('m', '10000');
    await redis.set('d', '10000');
    await store.reconcile(reservation, 3_000);
    expect(await redis.get('m')).toBe('3000');
    expect(await redis.get('d')).toBe('3000');
  });
});
