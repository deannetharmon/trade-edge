import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CapacityShadowResult } from '../shadowParity';

const { withAutopilotRedis, tx } = vi.hoisted(() => {
  const transaction: Record<string, ReturnType<typeof vi.fn>> = {
    hincrby: vi.fn(), expire: vi.fn(), lpush: vi.fn(), ltrim: vi.fn(), exec: vi.fn(),
  };
  for (const fn of Object.values(transaction)) fn.mockReturnValue(transaction);
  transaction.exec.mockResolvedValue([]);
  return {
    tx: transaction,
    withAutopilotRedis: vi.fn(async (callback: (redis: { multi: () => typeof transaction }) => Promise<void>) => callback({ multi: () => transaction })),
  };
});

vi.mock('@/lib/autopilot/persistence/redis', () => ({ withAutopilotRedis }));

import { CC_CAPACITY_SHADOW_REDIS_PREFIX, recordCoveredCallCapacityShadow } from '../shadowTelemetryStore';

describe('Covered Call shadow telemetry aggregation', () => {
  beforeEach(() => {
    for (const fn of Object.values(tx)) fn.mockClear();
  });

  it('records durable daily outcome, difference-kind, and field counts without identity keys', async () => {
    const result: CapacityShadowResult = {
      outcome: 'difference', comparedAt: '2026-08-22T18:01:00.000Z',
      snapshotAsOf: '2026-08-22T18:00:00.000Z', snapshotFreshness: 'current',
      differences: [{ kind: 'field', symbol: 'AAPL', field: 'sharesOwned', legacy: 100, snapshot: 200 }],
    };
    await recordCoveredCallCapacityShadow(result);
    const key = `${CC_CAPACITY_SHADOW_REDIS_PREFIX}:counts:2026-08-22`;
    expect(tx.hincrby).toHaveBeenCalledWith(key, 'total', 1);
    expect(tx.hincrby).toHaveBeenCalledWith(key, 'outcome:difference', 1);
    expect(tx.hincrby).toHaveBeenCalledWith(key, 'difference:field', 1);
    expect(tx.hincrby).toHaveBeenCalledWith(key, 'field:sharesOwned', 1);
    expect(tx.lpush).toHaveBeenCalledWith(`${CC_CAPACITY_SHADOW_REDIS_PREFIX}:recent`, JSON.stringify(result));
    expect(JSON.stringify(tx.hincrby.mock.calls)).not.toMatch(/user|account|token|session/i);
  });

  it('records skipped reasons as independently countable fields', async () => {
    await recordCoveredCallCapacityShadow({
      outcome: 'skipped', reason: 'snapshot-last-known', differences: [],
      comparedAt: '2026-08-22T18:01:00.000Z', snapshotAsOf: null, snapshotFreshness: 'last-known',
    });
    expect(tx.hincrby).toHaveBeenCalledWith(
      `${CC_CAPACITY_SHADOW_REDIS_PREFIX}:counts:2026-08-22`,
      'skipped:snapshot-last-known',
      1,
    );
  });
});
