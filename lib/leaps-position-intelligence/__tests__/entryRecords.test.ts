// lib/leaps-position-intelligence/__tests__/entryRecords.test.ts
//
// LEAPS-ENTRY-0001 -- the entry record builder, the open-date matching, and the Redis helpers.
// Worked example: GOOGL 250C 2027-06-17, bid 112.20 / ask 114.90, delta 0.84569266, stock 350.858.

import { describe, expect, it } from 'vitest';
import {
  brokerOrderIdOf, buildEntryRecord, ENTRY_RECORD_MAX_PER_CONTRACT, ENTRY_RECORD_TTL_SECONDS, selectEntryRecord,
  type BuildEntryRecordInput, type EntryLegSource, type LeapsEntryRecord,
} from '../entryRecords';
import { entryOrderMarkerKey, entryRecordsKey, readEntryRecords, saveEntryRecord, type EntryRedis } from '../entryRecordsStore';

const OCC = 'GOOGL 270617C00250000';
const SHORT_OCC = 'GOOGL 261016C00375000';
const leg = (over: Partial<EntryLegSource> = {}): EntryLegSource => ({
  occSymbol: OCC, strike: 250, expiration: '2027-06-17', dte: 270, bid: 112.2, ask: 114.9, delta: 0.84569266, impliedVolatility: 0.364, openInterest: 1296,
  optionQuoteTimestamp: '2026-08-14T15:29:40.000Z', spot: 350.858, underlyingQuoteTimestamp: '2026-08-14T15:29:45.000Z', ...over,
});
const input = (over: Partial<BuildEntryRecordInput> = {}): BuildEntryRecordInput => ({
  id: 'id-1', kind: 'leaps-entry', recordedAt: '2026-08-14T15:30:00.000Z', underlyingSymbol: 'GOOGL', longOccSymbol: OCC, shortOccSymbol: null,
  quantity: 1, limitPrice: 113.55, priceEffect: 'Debit', long: leg(), short: null, order: { order: { id: 4711 } }, ...over,
});

describe('buildEntryRecord', () => {
  it('records the market state at order time from the server-resolved review', () => {
    const r = buildEntryRecord(input());
    expect(r).toMatchObject({
      schemaVersion: 1, id: 'id-1', kind: 'leaps-entry', recordedAt: '2026-08-14T15:30:00.000Z', brokerOrderId: '4711',
      underlyingSymbol: 'GOOGL', longOccSymbol: OCC, shortOccSymbol: null, quantity: 1, limitPrice: 113.55, priceEffect: 'Debit',
      underlying: { price: 350.858, quoteAt: '2026-08-14T15:29:45.000Z' },
    });
    expect(r.long).toEqual({ occSymbol: OCC, strike: 250, expiration: '2027-06-17', dte: 270, bid: 112.2, ask: 114.9, mid: 113.55, delta: 0.8457, impliedVolatility: 0.364, openInterest: 1296, quoteAt: '2026-08-14T15:29:40.000Z' });
    expect(r.short).toBeNull();
  });

  it('computes the long call\'s extrinsic at order time (mid less intrinsic)', () => {
    // 113.55 - (350.858 - 250) = 12.692 ; 12.692 / 113.55 = 11.18%
    expect(buildEntryRecord(input()).extrinsic).toEqual({ perShare: 12.692, pctOfMid: 11.18 });
  });

  it('a PMCC entry keeps both legs; a short call sold keeps the held LEAPS state as context', () => {
    const short = leg({ occSymbol: SHORT_OCC, strike: 375, expiration: '2026-10-16', dte: 63, bid: 6.4, ask: 6.7, delta: 0.28 });
    const pmcc = buildEntryRecord(input({ kind: 'pmcc-entry', shortOccSymbol: SHORT_OCC, short }));
    expect(pmcc.short).toMatchObject({ occSymbol: SHORT_OCC, strike: 375, mid: 6.55, delta: 0.28 });
    const sold = buildEntryRecord(input({ kind: 'short-call-sold', shortOccSymbol: SHORT_OCC, short, priceEffect: 'Credit', limitPrice: 6.4 }));
    expect(sold).toMatchObject({ kind: 'short-call-sold', priceEffect: 'Credit', limitPrice: 6.4 });
    expect(sold.long!.occSymbol).toBe(OCC);
  });

  it('missing quotes or stock price leave mid and extrinsic null, never guessed', () => {
    expect(buildEntryRecord(input({ long: leg({ bid: null }) })).long).toMatchObject({ bid: null, mid: null });
    expect(buildEntryRecord(input({ long: leg({ bid: null }) })).extrinsic).toEqual({ perShare: null, pctOfMid: null });
    const noSpot = buildEntryRecord(input({ long: leg({ spot: null }) }));
    expect(noSpot.underlying.price).toBeNull();
    expect(noSpot.extrinsic).toEqual({ perShare: null, pctOfMid: null });
  });

  it('a call priced exactly at intrinsic has zero extrinsic (not negative zero)', () => {
    expect(buildEntryRecord(input({ long: leg({ bid: 100.8, ask: 100.9, spot: 350.85 }) })).extrinsic).toEqual({ perShare: 0, pctOfMid: 0 });
  });
});

describe('brokerOrderIdOf', () => {
  it.each([
    [{ order: { id: 4711 } }, '4711'], [{ order: { id: ' 88 ' } }, '88'], [{ id: 12 }, '12'], [{ id: 'abc' }, 'abc'],
    [{}, null], [null, null], [undefined, null], [{ order: { id: '' } }, null], [{ order: { id: NaN } }, null], ['text', null],
  ])('%j -> %s', (order, id) => {
    expect(brokerOrderIdOf(order)).toBe(id);
  });
});

describe('selectEntryRecord', () => {
  const rec = (id: string, recordedAt: string, kind: LeapsEntryRecord['kind'] = 'leaps-entry'): LeapsEntryRecord => ({ ...buildEntryRecord(input({ id, kind, recordedAt })) });
  const a = rec('a', '2026-08-14T15:30:00.000Z');
  const b = rec('b', '2026-08-01T15:30:00.000Z');

  it('picks the order placed on the open date', () => {
    expect(selectEntryRecord([b, a], '2026-08-14')).toMatchObject({ record: { id: 'a' }, daysBeforeFill: 0 });
  });
  it('a good-till-cancelled order that filled days later still matches, and says how many days earlier it was placed', () => {
    expect(selectEntryRecord([b, a], '2026-08-20')).toMatchObject({ record: { id: 'a' }, daysBeforeFill: 6 });
  });
  it('takes the latest order placed on or before the fill', () => {
    expect(selectEntryRecord([a, b], '2026-08-10')).toMatchObject({ record: { id: 'b' }, daysBeforeFill: 9 });
  });
  it('an order placed a day after the open date is tolerated (time zones); two days after is not', () => {
    expect(selectEntryRecord([rec('c', '2026-08-15T02:00:00.000Z')], '2026-08-14')).toMatchObject({ record: { id: 'c' }, daysBeforeFill: 0 });
    expect(selectEntryRecord([rec('d', '2026-08-16T02:00:00.000Z')], '2026-08-14')).toBeNull();
  });
  it('only entry kinds count; a short call sold is not the open', () => {
    expect(selectEntryRecord([rec('s', '2026-08-14T15:30:00.000Z', 'short-call-sold')], '2026-08-14')).toBeNull();
    expect(selectEntryRecord([rec('p', '2026-08-14T15:30:00.000Z', 'pmcc-entry')], '2026-08-14')).toMatchObject({ record: { id: 'p' } });
  });
  it('no records, no open date, or a malformed open date means no match', () => {
    expect(selectEntryRecord([], '2026-08-14')).toBeNull();
    expect(selectEntryRecord([a], null)).toBeNull();
    expect(selectEntryRecord([a], '08/14/2026')).toBeNull();
  });
});

// ---- Redis helpers with an in-memory fake ---------------------------------------------------------------------------------
function fakeRedis() {
  const strings = new Map<string, string>();
  const lists = new Map<string, string[]>();
  const expires = new Map<string, number>();
  const redis: EntryRedis = {
    async set(key, value, ...args) { if (args.includes('NX') && strings.has(key)) return null; strings.set(key, value); return 'OK'; },
    async lpush(key, value) { lists.set(key, [value, ...(lists.get(key) ?? [])]); return 1; },
    async ltrim(key, start, stop) { lists.set(key, (lists.get(key) ?? []).slice(start, stop + 1)); return 'OK'; },
    async expire(key, seconds) { expires.set(key, seconds); return 1; },
    async lrange(key, start, stop) { return (lists.get(key) ?? []).slice(start, stop + 1); },
  };
  return { redis, strings, lists, expires };
}

describe('saveEntryRecord / readEntryRecords', () => {
  const identity = { userId: 'user-a', accountNumber: 'ACCT-1' };

  it('saves newest first, with the retention TTL, and reads it back', async () => {
    const { redis, expires } = fakeRedis();
    expect(await saveEntryRecord(redis, identity, buildEntryRecord(input({ id: 'one', order: { id: 1 } })))).toBe('saved');
    expect(await saveEntryRecord(redis, identity, buildEntryRecord(input({ id: 'two', order: { id: 2 } })))).toBe('saved');
    const read = await readEntryRecords(redis, { ...identity, longOccSymbol: OCC });
    expect(read.map(r => r.id)).toEqual(['two', 'one']);
    expect(expires.get(entryRecordsKey('user-a', 'ACCT-1', OCC))).toBe(ENTRY_RECORD_TTL_SECONDS);
  });

  it('one record per broker order: a repeat is a duplicate and adds nothing', async () => {
    const { redis } = fakeRedis();
    expect(await saveEntryRecord(redis, identity, buildEntryRecord(input({ id: 'one', order: { id: 7 } })))).toBe('saved');
    expect(await saveEntryRecord(redis, identity, buildEntryRecord(input({ id: 'again', order: { id: 7 } })))).toBe('duplicate');
    expect((await readEntryRecords(redis, { ...identity, longOccSymbol: OCC })).map(r => r.id)).toEqual(['one']);
  });

  it('a record with no readable order id is still saved (it cannot be de-duplicated)', async () => {
    const { redis } = fakeRedis();
    await saveEntryRecord(redis, identity, buildEntryRecord(input({ id: 'x', order: {} })));
    await saveEntryRecord(redis, identity, buildEntryRecord(input({ id: 'y', order: {} })));
    expect((await readEntryRecords(redis, { ...identity, longOccSymbol: OCC })).length).toBe(2);
  });

  it('keeps at most the newest ENTRY_RECORD_MAX_PER_CONTRACT records', async () => {
    const { redis, lists } = fakeRedis();
    for (let i = 0; i < ENTRY_RECORD_MAX_PER_CONTRACT + 5; i++) await saveEntryRecord(redis, identity, buildEntryRecord(input({ id: `r${i}`, order: { id: 1000 + i } })));
    const list = lists.get(entryRecordsKey('user-a', 'ACCT-1', OCC))!;
    expect(list.length).toBe(ENTRY_RECORD_MAX_PER_CONTRACT);
    expect(JSON.parse(list[0]).id).toBe(`r${ENTRY_RECORD_MAX_PER_CONTRACT + 4}`);
  });

  it('is isolated by user, account and contract, and the keys hold no raw identifiers', async () => {
    const { redis } = fakeRedis();
    await saveEntryRecord(redis, identity, buildEntryRecord(input({ id: 'mine', order: { id: 1 } })));
    expect(await readEntryRecords(redis, { userId: 'user-b', accountNumber: 'ACCT-1', longOccSymbol: OCC })).toEqual([]);
    expect(await readEntryRecords(redis, { userId: 'user-a', accountNumber: 'ACCT-2', longOccSymbol: OCC })).toEqual([]);
    expect(await readEntryRecords(redis, { userId: 'user-a', accountNumber: 'ACCT-1', longOccSymbol: 'GOOGL 270617C00300000' })).toEqual([]);
    for (const key of [entryRecordsKey('user-a', 'ACCT-1', OCC), entryOrderMarkerKey('user-a', '4711')]) {
      expect(key).not.toContain('user-a');
      expect(key).not.toContain('ACCT-1');
      expect(key).not.toContain('GOOGL');
    }
  });

  it('skips malformed or wrong-schema entries instead of failing', async () => {
    const { redis, lists } = fakeRedis();
    await saveEntryRecord(redis, identity, buildEntryRecord(input({ id: 'good', order: { id: 1 } })));
    const key = entryRecordsKey('user-a', 'ACCT-1', OCC);
    lists.set(key, ['not json', JSON.stringify({ schemaVersion: 99, id: 'old', recordedAt: 'x' }), ...(lists.get(key) ?? [])]);
    expect((await readEntryRecords(redis, { ...identity, longOccSymbol: OCC })).map(r => r.id)).toEqual(['good']);
  });

  it('never stores the account number or any token in the record itself', async () => {
    const r = buildEntryRecord(input());
    expect(JSON.stringify(r)).not.toContain('ACCT');
    expect(Object.keys(r)).not.toContain('accountNumber');
  });
});
