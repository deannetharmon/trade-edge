import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CapacityShadowResult } from '../shadowParity';

const { withAutopilotRedis, redis, tx } = vi.hoisted(() => {
  const transaction: Record<string, ReturnType<typeof vi.fn>> = {
    hincrby: vi.fn(), expire: vi.fn(), zadd: vi.fn(), zremrangebyscore: vi.fn(),
    zremrangebyrank: vi.fn(), exec: vi.fn(),
  };
  for (const fn of Object.values(transaction)) fn.mockReturnValue(transaction);
  transaction.exec.mockResolvedValue([]);
  const client = {
    eval: vi.fn().mockResolvedValue(1),
    set: vi.fn().mockResolvedValue('OK'),
    multi: vi.fn(() => transaction),
  };
  return {
    tx: transaction,
    redis: client,
    withAutopilotRedis: vi.fn(async (callback: (value: typeof client) => Promise<unknown>) => callback(client)),
  };
});

vi.mock('@/lib/autopilot/persistence/redis', () => ({ withAutopilotRedis }));

import {
  CC_CAPACITY_SHADOW_REDIS_PREFIX,
  ingestCoveredCallCapacityShadow,
} from '../shadowTelemetryStore';
import {
  CC_CAPACITY_SHADOW_DEDUPE_SECONDS,
  CC_CAPACITY_SHADOW_RATE_LIMIT,
  CC_CAPACITY_SHADOW_RATE_WINDOW_SECONDS,
  CC_CAPACITY_SHADOW_RETENTION_SECONDS,
} from '../shadowTelemetrySchema';

const result: CapacityShadowResult = {
  outcome: 'difference', comparedAt: '1999-01-01T00:00:00.000Z',
  snapshotAsOf: '2026-08-22T18:00:00.000Z', snapshotFreshness: 'current',
  differences: [{ kind: 'field', symbol: 'AAPL', field: 'sharesOwned', legacy: 100, snapshot: 200 }],
};
const context = {
  receivedAt: '2026-08-22T18:05:00.000Z',
  identityHash: 'identityhash',
  eventFingerprint: 'eventfingerprint',
};

describe('Covered Call shadow telemetry aggregation', () => {
  beforeEach(() => {
    for (const fn of Object.values(tx)) fn.mockClear();
    for (const fn of Object.values(redis)) if ('mockClear' in fn) fn.mockClear();
    redis.eval.mockResolvedValue(1);
    redis.set.mockResolvedValue('OK');
  });

  it('uses server receipt day and retains recent evidence by server score, age, count, and TTL', async () => {
    expect(await ingestCoveredCallCapacityShadow(result, context)).toBe('accepted');
    const key = `${CC_CAPACITY_SHADOW_REDIS_PREFIX}:counts:2026-08-22`;
    expect(tx.hincrby).toHaveBeenCalledWith(key, 'total', 1);
    expect(tx.hincrby).toHaveBeenCalledWith(key, 'outcome:difference', 1);
    expect(tx.hincrby).toHaveBeenCalledWith(key, 'difference:field', 1);
    expect(tx.hincrby).toHaveBeenCalledWith(key, 'field:sharesOwned', 1);
    expect(tx.expire).toHaveBeenCalledWith(key, CC_CAPACITY_SHADOW_RETENTION_SECONDS);
    const receivedAtMs = new Date(context.receivedAt).getTime();
    const cutoffMs = receivedAtMs - CC_CAPACITY_SHADOW_RETENTION_SECONDS * 1000;
    expect(tx.zadd).toHaveBeenCalledWith(
      `${CC_CAPACITY_SHADOW_REDIS_PREFIX}:recent`,
      receivedAtMs,
      JSON.stringify({ ...result, receivedAt: context.receivedAt }),
    );
    expect(tx.zremrangebyscore).toHaveBeenCalledWith(
      `${CC_CAPACITY_SHADOW_REDIS_PREFIX}:recent`, '-inf', `(${cutoffMs}`,
    );
    expect(tx.zremrangebyrank).toHaveBeenCalledWith(
      `${CC_CAPACITY_SHADOW_REDIS_PREFIX}:recent`, 0, -501,
    );
    expect(tx.expire).toHaveBeenCalledWith(
      `${CC_CAPACITY_SHADOW_REDIS_PREFIX}:recent`, CC_CAPACITY_SHADOW_RETENTION_SECONDS,
    );
    expect(JSON.stringify(tx.hincrby.mock.calls)).not.toContain('1999-01-01');
  });

  it('uses bounded hashed rate and dedupe keys', async () => {
    await ingestCoveredCallCapacityShadow(result, context);
    const window = Math.floor(new Date(context.receivedAt).getTime() / (CC_CAPACITY_SHADOW_RATE_WINDOW_SECONDS * 1000));
    expect(redis.eval).toHaveBeenCalledWith(
      expect.stringContaining("redis.call('EXPIRE'"),
      1,
      `${CC_CAPACITY_SHADOW_REDIS_PREFIX}:rate:identityhash:${window}`,
      CC_CAPACITY_SHADOW_RATE_WINDOW_SECONDS + 5,
    );
    expect(redis.set).toHaveBeenCalledWith(
      `${CC_CAPACITY_SHADOW_REDIS_PREFIX}:dedupe:eventfingerprint`,
      '1', 'EX', CC_CAPACITY_SHADOW_DEDUPE_SECONDS, 'NX',
    );
  });

  it('does not write telemetry for duplicates or rate excess', async () => {
    redis.set.mockResolvedValueOnce(null);
    expect(await ingestCoveredCallCapacityShadow(result, context)).toBe('duplicate');
    expect(tx.hincrby).not.toHaveBeenCalled();
    expect(tx.zadd).not.toHaveBeenCalled();

    redis.eval.mockResolvedValueOnce(CC_CAPACITY_SHADOW_RATE_LIMIT + 1);
    expect(await ingestCoveredCallCapacityShadow(result, context)).toBe('rate-limited');
    expect(redis.set).toHaveBeenCalledTimes(1);
    expect(tx.hincrby).not.toHaveBeenCalled();
    expect(tx.zadd).not.toHaveBeenCalled();
  });

  it('counts distinct legitimate events within the limit independently', async () => {
    expect(await ingestCoveredCallCapacityShadow(result, context)).toBe('accepted');
    expect(await ingestCoveredCallCapacityShadow(
      { ...result, comparedAt: '2026-08-22T18:02:00.000Z' },
      { ...context, eventFingerprint: 'different-event-fingerprint' },
    )).toBe('accepted');
    expect(tx.hincrby.mock.calls.filter(call => call[1] === 'total')).toHaveLength(2);
    expect(tx.zadd).toHaveBeenCalledTimes(2);
  });

  it('accepts through the configured limit and rejects the first excess event without evidence writes', async () => {
    let count = 0;
    redis.eval.mockImplementation(async () => ++count);
    for (let index = 0; index < CC_CAPACITY_SHADOW_RATE_LIMIT; index += 1) {
      expect(await ingestCoveredCallCapacityShadow(
        { ...result, comparedAt: new Date(Date.parse(result.comparedAt) + index).toISOString() },
        { ...context, eventFingerprint: `event-${index}` },
      )).toBe('accepted');
    }
    const writesAtLimit = tx.zadd.mock.calls.length;
    expect(writesAtLimit).toBe(CC_CAPACITY_SHADOW_RATE_LIMIT);
    expect(await ingestCoveredCallCapacityShadow(
      result,
      { ...context, eventFingerprint: 'event-over-limit' },
    )).toBe('rate-limited');
    expect(tx.zadd).toHaveBeenCalledTimes(writesAtLimit);
    expect(tx.hincrby.mock.calls.filter(call => call[1] === 'total')).toHaveLength(CC_CAPACITY_SHADOW_RATE_LIMIT);
  });

  it('records skipped reasons as independently countable fields', async () => {
    await ingestCoveredCallCapacityShadow({
      outcome: 'skipped', reason: 'snapshot-last-known', differences: [],
      comparedAt: '2026-08-22T18:01:00.000Z', snapshotAsOf: null, snapshotFreshness: 'last-known',
    }, context);
    expect(tx.hincrby).toHaveBeenCalledWith(
      `${CC_CAPACITY_SHADOW_REDIS_PREFIX}:counts:2026-08-22`,
      'skipped:snapshot-last-known',
      1,
    );
  });
});
