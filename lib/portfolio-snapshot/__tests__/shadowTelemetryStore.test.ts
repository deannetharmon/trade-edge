import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CapacityShadowResult } from '../shadowParity';

const { withAutopilotRedis, redis, tx } = vi.hoisted(() => {
  const transaction: Record<string, ReturnType<typeof vi.fn>> = {
    hincrby: vi.fn(), expire: vi.fn(), eval: vi.fn(), exec: vi.fn(),
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
  CC_CAPACITY_SHADOW_RECENT_EVENT_PREFIX,
  CC_CAPACITY_SHADOW_RECENT_INDEX_KEY,
  CC_CAPACITY_SHADOW_REDIS_PREFIX,
  ingestCoveredCallCapacityShadow,
  readCoveredCallCapacityShadowRecent,
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
    expect(tx.eval).toHaveBeenCalledWith(
      expect.stringContaining("redis.call('SET', eventKey, payload, 'PXAT', expiresAtMs)"),
      2,
      CC_CAPACITY_SHADOW_RECENT_INDEX_KEY,
      `${CC_CAPACITY_SHADOW_RECENT_EVENT_PREFIX}${context.eventFingerprint}`,
      CC_CAPACITY_SHADOW_RECENT_EVENT_PREFIX,
      context.eventFingerprint,
      JSON.stringify({ ...result, receivedAt: context.receivedAt }),
      receivedAtMs,
      cutoffMs,
      receivedAtMs + CC_CAPACITY_SHADOW_RETENTION_SECONDS * 1000,
      500,
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
    expect(tx.eval).not.toHaveBeenCalled();

    redis.eval.mockResolvedValueOnce(CC_CAPACITY_SHADOW_RATE_LIMIT + 1);
    expect(await ingestCoveredCallCapacityShadow(result, context)).toBe('rate-limited');
    expect(redis.set).toHaveBeenCalledTimes(1);
    expect(tx.hincrby).not.toHaveBeenCalled();
    expect(tx.eval).not.toHaveBeenCalled();
  });

  it('counts distinct legitimate events within the limit independently', async () => {
    expect(await ingestCoveredCallCapacityShadow(result, context)).toBe('accepted');
    expect(await ingestCoveredCallCapacityShadow(
      { ...result, comparedAt: '2026-08-22T18:02:00.000Z' },
      { ...context, eventFingerprint: 'different-event-fingerprint' },
    )).toBe('accepted');
    expect(tx.hincrby.mock.calls.filter(call => call[1] === 'total')).toHaveLength(2);
    expect(tx.eval).toHaveBeenCalledTimes(2);
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
    const writesAtLimit = tx.eval.mock.calls.length;
    expect(writesAtLimit).toBe(CC_CAPACITY_SHADOW_RATE_LIMIT);
    expect(await ingestCoveredCallCapacityShadow(
      result,
      { ...context, eventFingerprint: 'event-over-limit' },
    )).toBe('rate-limited');
    expect(tx.eval).toHaveBeenCalledTimes(writesAtLimit);
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

function createStatefulRedis(startMs: number) {
  let nowMs = startMs;
  const values = new Map<string, { value: string; expiresAt: number | null }>();
  const scores = new Map<string, number>();
  const rateCounts = new Map<string, number>();

  const getValue = (key: string): string | null => {
    const entry = values.get(key);
    if (!entry) return null;
    if (entry.expiresAt !== null && nowMs >= entry.expiresAt) {
      values.delete(key);
      return null;
    }
    return entry.value;
  };

  const prune = (cutoffMs: number) => {
    for (const [id, score] of Array.from(scores.entries())) {
      if (score <= cutoffMs) {
        scores.delete(id);
        values.delete(`${CC_CAPACITY_SHADOW_RECENT_EVENT_PREFIX}${id}`);
      }
    }
  };

  const applyRecentWrite = (args: unknown[]) => {
    const [, , , eventKey, eventPrefix, eventId, payload, receivedAt, cutoff, expiresAt, max] = args;
    prune(Number(cutoff));
    values.set(String(eventKey), { value: String(payload), expiresAt: Number(expiresAt) });
    scores.set(String(eventId), Number(receivedAt));
    const ordered = Array.from(scores.entries()).sort((left, right) => left[1] - right[1]);
    const excess = Math.max(0, ordered.length - Number(max));
    for (const [id] of ordered.slice(0, excess)) {
      scores.delete(id);
      values.delete(`${String(eventPrefix)}${id}`);
    }
    return scores.size;
  };

  const applyRecentRead = (args: unknown[]) => {
    const [, , eventPrefix, cutoff, limit] = args;
    prune(Number(cutoff));
    const ordered = Array.from(scores.entries()).sort((left, right) => right[1] - left[1]);
    const payloads: string[] = [];
    for (const [id] of ordered) {
      const payload = getValue(`${String(eventPrefix)}${id}`);
      if (payload === null) scores.delete(id);
      else if (payloads.length < Number(limit)) payloads.push(payload);
    }
    return payloads;
  };

  const client = {
    eval: vi.fn(async (script: string, ...args: unknown[]) => {
      if (script.includes("redis.call('INCR'")) {
        const key = String(args[1]);
        const next = (rateCounts.get(key) ?? 0) + 1;
        rateCounts.set(key, next);
        return next;
      }
      return applyRecentRead(args);
    }),
    set: vi.fn(async (key: string, value: string, _ex: string, ttl: number, mode: string) => {
      if (mode === 'NX' && getValue(key) !== null) return null;
      values.set(key, { value, expiresAt: nowMs + ttl * 1000 });
      return 'OK';
    }),
    multi: vi.fn(() => {
      const queued: Array<{ command: string; args: unknown[] }> = [];
      const chain: Record<string, (...args: unknown[]) => unknown> = {};
      for (const command of ['hincrby', 'expire', 'eval']) {
        chain[command] = (...args: unknown[]) => {
          queued.push({ command, args });
          return chain;
        };
      }
      chain.exec = async () => queued.map(({ command, args }) => [
        null,
        command === 'eval' ? applyRecentWrite(args) : 1,
      ]);
      return chain;
    }),
  };

  return {
    client,
    setNow: (value: number) => { nowMs = value; },
    hasPayload: (id: string) => getValue(`${CC_CAPACITY_SHADOW_RECENT_EVENT_PREFIX}${id}`) !== null,
    hasIndex: (id: string) => scores.has(id),
    indexSize: () => scores.size,
    addDangling: (id: string, score: number) => scores.set(id, score),
  };
}

describe('Covered Call shadow telemetry elapsed-time retention', () => {
  const DAY_MS = 24 * 60 * 60 * 1000;
  const baseMs = Date.parse('2026-01-01T00:00:00.000Z');
  let stateful: ReturnType<typeof createStatefulRedis>;

  beforeEach(() => {
    stateful = createStatefulRedis(baseMs);
    withAutopilotRedis.mockImplementation(async callback => callback(stateful.client as never));
  });

  const writeAt = async (day: number, id: string) => {
    const receivedAtMs = baseMs + day * DAY_MS;
    stateful.setNow(receivedAtMs);
    await ingestCoveredCallCapacityShadow(result, {
      receivedAt: new Date(receivedAtMs).toISOString(),
      identityHash: `identity-${id}`,
      eventFingerprint: id,
    });
  };

  it('expires an older payload through a quiet period even after a later write', async () => {
    await writeAt(0, 'event-a');
    await writeAt(89, 'event-b');
    stateful.setNow(baseMs + 90 * DAY_MS + 1);
    const recent = await readCoveredCallCapacityShadowRecent(new Date(baseMs + 90 * DAY_MS + 1));
    expect(recent.map(event => event.receivedAt)).toEqual([new Date(baseMs + 89 * DAY_MS).toISOString()]);
    expect(stateful.hasPayload('event-a')).toBe(false);
    expect(stateful.hasIndex('event-a')).toBe(false);
    expect(stateful.hasPayload('event-b')).toBe(true);
  });

  it('excludes an event at the exact 90-day cutoff without another write', async () => {
    await writeAt(0, 'event-a');
    stateful.setNow(baseMs + 90 * DAY_MS);
    expect(await readCoveredCallCapacityShadowRecent(new Date(baseMs + 90 * DAY_MS))).toEqual([]);
    expect(stateful.hasPayload('event-a')).toBe(false);
  });

  it('returns no financial evidence after a complete quiet period beyond retention', async () => {
    await writeAt(0, 'event-a');
    stateful.setNow(baseMs + 91 * DAY_MS);
    expect(await readCoveredCallCapacityShadowRecent(new Date(baseMs + 91 * DAY_MS))).toEqual([]);
  });

  it('removes event 1 and its payload immediately when event 501 is accepted', async () => {
    for (let index = 0; index < 501; index += 1) {
      await writeAt(index / 1440, `event-${index}`);
    }
    expect(stateful.indexSize()).toBe(500);
    expect(stateful.hasIndex('event-0')).toBe(false);
    expect(stateful.hasPayload('event-0')).toBe(false);
    expect(stateful.hasPayload('event-500')).toBe(true);
    expect(await readCoveredCallCapacityShadowRecent(new Date(baseMs + 501 / 1440 * DAY_MS))).toHaveLength(500);
  });

  it('cleans a dangling index member during the supported read', async () => {
    stateful.addDangling('missing-payload', baseMs);
    expect(await readCoveredCallCapacityShadowRecent(new Date(baseMs), 10)).toEqual([]);
    expect(stateful.hasIndex('missing-payload')).toBe(false);
  });

  it('uses server receipt time rather than client comparedAt for payload expiration', async () => {
    await writeAt(0, 'event-a');
    stateful.setNow(baseMs + 90 * DAY_MS);
    expect(await readCoveredCallCapacityShadowRecent(new Date(baseMs + 90 * DAY_MS))).toEqual([]);
  });
});
