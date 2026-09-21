// lib/leaps-position-intelligence/__tests__/entryCapture.test.ts
//
// LEAPS-ENTRY-0001 -- best-effort capture: it must never throw, never wait long, and never touch the order it follows.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getRedis = vi.fn();
vi.mock('@/lib/jobs/redis', () => ({ getRedis: () => getRedis() }));
const recordLedger = vi.fn(async (..._args: unknown[]) => undefined);
vi.mock('../ledgerStore', () => ({ recordLedgerEvent: (...args: unknown[]) => recordLedger(...args) }));

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
beforeEach(() => { getRedis.mockReset(); recordLedger.mockClear(); recordLedger.mockImplementation(async () => undefined); errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined); });
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

describe('the decision ledger (LEAPS-LEDGER-0001)', () => {
  it('an accepted order is also recorded as a server-attested decision, with the same identity and an order-derived request id', async () => {
    const { redis } = memoryRedis();
    const ledger = vi.fn(async () => undefined);
    expect(await recordEntryBestEffort(input({ kind: 'short-call-sold', shortOccSymbol: 'GOOGL 261016C00375000', priceEffect: 'Credit', limitPrice: 6.4 }), { redis, ledger, now: () => new Date('2026-08-14T15:30:00.000Z') })).toBe('saved');
    expect(ledger).toHaveBeenCalledTimes(1);
    const [identity, event] = ledger.mock.calls[0] as unknown as [unknown, Record<string, unknown>];
    expect(identity).toEqual({ userId: 'user-a', canonicalAccountId: 'ACCT-1', longOccSymbol: OCC });
    expect(event).toMatchObject({
      type: 'user-decision', actor: 'trader', at: '2026-08-14T15:30:00.000Z', requestId: 'order-4711', retention: 'append-only',
      payload: { action: 'sold-short-call', attestation: 'server', brokerOrderId: '4711', quantity: 1, limitPrice: 6.4, priceEffect: 'Credit', shortOccSymbol: 'GOOGL 261016C00375000' },
    });
    expect((event.payload as { entryRecordId: string }).entryRecordId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('a repeated order (duplicate record) is not recorded in the ledger again', async () => {
    const { redis } = memoryRedis();
    const ledger = vi.fn(async () => undefined);
    await recordEntryBestEffort(input(), { redis, ledger });
    expect(await recordEntryBestEffort(input(), { redis, ledger })).toBe('duplicate');
    expect(ledger).toHaveBeenCalledTimes(1);
  });

  it('a ledger failure never changes the outcome and leaks nothing', async () => {
    const { redis } = memoryRedis();
    const ledger = vi.fn(async () => { throw new Error('redis://user:secret@host'); });
    await expect(recordEntryBestEffort(input(), { redis, ledger })).resolves.toBe('saved');
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain('secret');
  });

  it('a Redis failure in the entry record means no ledger event and a "failed" outcome', async () => {
    const { redis } = memoryRedis({ lpush: async () => { throw new Error('down'); } });
    const ledger = vi.fn(async () => undefined);
    await expect(recordEntryBestEffort(input(), { redis, ledger })).resolves.toBe('failed');
    expect(ledger).not.toHaveBeenCalled();
  });

  it('by default it writes through the shared ledger store', async () => {
    const { redis } = memoryRedis();
    getRedis.mockReturnValue({ shared: 'redis' });
    await recordEntryBestEffort(input(), { redis });
    expect(recordLedger).toHaveBeenCalledTimes(1);
    expect(recordLedger.mock.calls[0][0]).toEqual({ shared: 'redis' });
    expect(recordLedger.mock.calls[0][1]).toEqual({ userId: 'user-a', canonicalAccountId: 'ACCT-1', longOccSymbol: OCC });
  });

  it('a slow ledger write is covered by the same timeout as the record', async () => {
    const { redis } = memoryRedis();
    const ledger = vi.fn(() => new Promise<void>(() => undefined));
    await expect(recordEntryBestEffort(input(), { redis, ledger, timeoutMs: 30 })).resolves.toBe('timeout');
  });
});
