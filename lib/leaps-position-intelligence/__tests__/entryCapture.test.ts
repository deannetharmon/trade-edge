// lib/leaps-position-intelligence/__tests__/entryCapture.test.ts
//
// LEAPS-ENTRY-0001 -- best-effort capture: it must never throw, never wait long, and never touch the order it follows.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getRedis = vi.fn();
vi.mock('@/lib/jobs/redis', () => ({ getRedis: () => getRedis() }));

import { ENTRY_CAPTURE_TIMEOUT_MS, recordEntryBestEffort, type RecordEntryInput } from '../entryCapture';
import { entryRecordsKey, type EntryRedis } from '../entryRecordsStore';

const OCC = 'GOOGL 270617C00250000';
const leg = { occSymbol: OCC, strike: 250, expiration: '2027-06-17', dte: 270, bid: 112.2, ask: 114.9, delta: 0.84569266, impliedVolatility: 0.364, openInterest: 1296, optionQuoteTimestamp: '2026-08-14T15:29:40.000Z', spot: 350.858, underlyingQuoteTimestamp: '2026-08-14T15:29:45.000Z' };
const input = (over: Partial<RecordEntryInput> = {}): RecordEntryInput => ({
  kind: 'leaps-entry', userId: 'user-a', accountNumber: 'ACCT-1', underlyingSymbol: 'GOOGL', longOccSymbol: OCC, shortOccSymbol: null,
  quantity: 1, limitPrice: 113.55, priceEffect: 'Debit', long: leg, short: null, order: { order: { id: 4711 } }, ...over,
});

function memoryRedis(overrides: Partial<EntryRedis> = {}) {
  const lists = new Map<string, string[]>(); const strings = new Set<string>();
  const redis: EntryRedis = {
    async set(key, _v, ...args) { if (args.includes('NX') && strings.has(key)) return null; strings.add(key); return 'OK'; },
    async lpush(key, value) { lists.set(key, [value, ...(lists.get(key) ?? [])]); return 1; },
    async ltrim() { return 'OK'; }, async expire() { return 1; },
    async lrange(key) { return lists.get(key) ?? []; },
    ...overrides,
  };
  return { redis, lists };
}

let errorSpy: { mockRestore: () => void; mock: { calls: unknown[][] } };
beforeEach(() => { getRedis.mockReset(); errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined); });
afterEach(() => { errorSpy.mockRestore(); vi.useRealTimers(); });

describe('recordEntryBestEffort', () => {
  it('saves the record under the user, account and long contract', async () => {
    const { redis, lists } = memoryRedis();
    expect(await recordEntryBestEffort(input(), { redis, now: () => new Date('2026-08-14T15:30:00.000Z') })).toBe('saved');
    const saved = JSON.parse(lists.get(entryRecordsKey('user-a', 'ACCT-1', OCC))![0]);
    expect(saved).toMatchObject({ kind: 'leaps-entry', recordedAt: '2026-08-14T15:30:00.000Z', brokerOrderId: '4711', quantity: 1, limitPrice: 113.55, underlying: { price: 350.858 } });
    expect(saved.long.mid).toBe(113.55);
  });

  it('a repeated order id is reported as a duplicate', async () => {
    const { redis } = memoryRedis();
    await recordEntryBestEffort(input(), { redis });
    expect(await recordEntryBestEffort(input(), { redis })).toBe('duplicate');
  });

  it('a Redis failure never throws: the outcome is "failed" and nothing sensitive is logged', async () => {
    const { redis } = memoryRedis({ lpush: async () => { throw new Error('redis://user:secret@host exploded'); } });
    await expect(recordEntryBestEffort(input(), { redis })).resolves.toBe('failed');
    expect(errorSpy).toHaveBeenCalled();
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain('secret');
  });

  it('missing Redis configuration never throws', async () => {
    getRedis.mockImplementation(() => { throw new Error('Redis is not configured. Set REDIS_URL'); });
    await expect(recordEntryBestEffort(input())).resolves.toBe('failed');
  });

  it('an unexpected input shape never throws', async () => {
    const { redis } = memoryRedis();
    await expect(recordEntryBestEffort({ ...input(), long: { ...leg, bid: 'x' as unknown as number } }, { redis })).resolves.toBe('saved');
    await expect(recordEntryBestEffort(null as unknown as RecordEntryInput, { redis })).resolves.toBe('failed');
  });

  it('gives up after the timeout instead of holding the order response', async () => {
    const { redis } = memoryRedis({ lpush: () => new Promise(() => undefined) });
    const started = Date.now();
    await expect(recordEntryBestEffort(input(), { redis, timeoutMs: 30 })).resolves.toBe('timeout');
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it('a slow write that fails after the timeout does not become an unhandled rejection', async () => {
    let fail: (e: Error) => void = () => undefined;
    const { redis } = memoryRedis({ lpush: () => new Promise((_, reject) => { fail = reject; }) });
    await expect(recordEntryBestEffort(input(), { redis, timeoutMs: 10 })).resolves.toBe('timeout');
    fail(new Error('late failure'));
    await new Promise(resolve => setTimeout(resolve, 20));
  });

  it('defaults to a short timeout', () => {
    expect(ENTRY_CAPTURE_TIMEOUT_MS).toBeLessThanOrEqual(3000);
  });
});
