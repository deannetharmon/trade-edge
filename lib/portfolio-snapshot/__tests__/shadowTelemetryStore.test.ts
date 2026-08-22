import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CapacityShadowResult } from '../shadowParity';

const { withAutopilotRedis, redis, tx } = vi.hoisted(() => {
  const transaction: Record<string, ReturnType<typeof vi.fn>> = {
    hincrby: vi.fn(), expire: vi.fn(), lpush: vi.fn(), ltrim: vi.fn(), exec: vi.fn(),
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

  it('uses server receipt day, counts once, and caps recent evidence without claiming per-event TTL', async () => {
    expect(await ingestCoveredCallCapacityShadow(result, context)).toBe('accepted');
    const key = `${CC_CAPACITY_SHADOW_REDIS_PREFIX}:counts:2026-08-22`;
    expect(tx.hincrby).toHaveBeenCalledWith(key, 'total', 1);
    expect(tx.hincrby).toHaveBeenCalledWith(key, 'outcome:difference', 1);
    expect(tx.hincrby).toHaveBeenCalledWith(key, 'difference:field', 1);
    expect(tx.hincrby).toHaveBeenCalledWith(key, 'field:sharesOwned', 1);
    expect(tx.expire).toHaveBeenCalledWith(key, CC_CAPACITY_SHADOW_RETENTION_SECONDS);
    expect(tx.lpush).toHaveBeenCalledWith(
      `${CC_CAPACITY_SHADOW_REDIS_PREFIX}:recent`,
      JSON.stringify({ ...result, receivedAt: context.receivedAt }),
    );
    expect(tx.ltrim).toHaveBeenCalledWith(`${CC_CAPACITY_SHADOW_REDIS_PREFIX}:recent`, 0, 499);
    expect(tx.expire).toHaveBeenCalledTimes(1);
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
    expect(tx.lpush).not.toHaveBeenCalled();

    redis.eval.mockResolvedValueOnce(CC_CAPACITY_SHADOW_RATE_LIMIT + 1);
    expect(await ingestCoveredCallCapacityShadow(result, context)).toBe('rate-limited');
    expect(redis.set).toHaveBeenCalledTimes(1);
    expect(tx.hincrby).not.toHaveBeenCalled();
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
