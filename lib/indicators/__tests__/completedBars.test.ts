// lib/indicators/__tests__/completedBars.test.ts

// RSI-ENTRY-0001 slice P: completedDailyCloses drops only the still-forming last bar, using New York time.
// Instants are written in UTC: 2026-10-01 is daylight time (ET = UTC-4, open 13:30Z, close 20:00Z) and 2026-12-01 is
// standard time (ET = UTC-5, open 14:30Z, close 21:00Z), so the daylight-saving shift is covered both ways.

import { describe, expect, it } from 'vitest';
import { completedDailyCloses, MARKET_CLOSE_ET_MINUTES } from '../completedBars';
import { rsiSeries } from '../rsi';

const sec = (iso: string) => Date.parse(iso) / 1000;
const bar = (iso: string, c: number) => ({ t: sec(iso), c });
const at = (iso: string) => new Date(iso);

// Three sessions ending Thursday 2026-10-01 (daylight time): open at 13:30Z.
const SEP29 = bar('2026-09-29T13:30:00Z', 100);
const SEP30 = bar('2026-09-30T13:30:00Z', 101);
const OCT01 = bar('2026-10-01T13:30:00Z', 102);

describe('completedDailyCloses: the forming bar', () => {
  it('drops today\'s bar while the market is open', () => {
    expect(completedDailyCloses([SEP29, SEP30, OCT01], at('2026-10-01T15:00:00Z'))).toEqual([100, 101]); // 11:00 ET
  });
  it('drops today\'s bar before the open (07:00 ET)', () => {
    expect(completedDailyCloses([SEP29, SEP30, OCT01], at('2026-10-01T11:00:00Z'))).toEqual([100, 101]);
  });
  it('the cut is exactly 16:00 ET: 15:59:59 drops the bar, 16:00:00 keeps it (daylight time)', () => {
    expect(completedDailyCloses([SEP29, SEP30, OCT01], at('2026-10-01T19:59:59Z'))).toEqual([100, 101]);
    expect(completedDailyCloses([SEP29, SEP30, OCT01], at('2026-10-01T20:00:00Z'))).toEqual([100, 101, 102]);
  });
  it('the same cut holds in standard time (16:00 ET is 21:00Z)', () => {
    const nov30 = bar('2026-11-30T14:30:00Z', 200);
    const dec01 = bar('2026-12-01T14:30:00Z', 201);
    expect(completedDailyCloses([nov30, dec01], at('2026-12-01T20:59:59Z'))).toEqual([200]);
    expect(completedDailyCloses([nov30, dec01], at('2026-12-01T21:00:00Z'))).toEqual([200, 201]);
  });
  it('uses the New York date, not the UTC date, after UTC midnight', () => {
    // 22:00 ET on 2026-10-01 is already 2026-10-02 in UTC; the 10-01 bar is still today's New York bar and is complete.
    expect(completedDailyCloses([SEP30, OCT01], at('2026-10-02T02:00:00Z'))).toEqual([101, 102]);
  });
  it('keeps every bar on a weekend (the last bar is a prior day)', () => {
    const oct02 = bar('2026-10-02T13:30:00Z', 103); // Friday
    expect(completedDailyCloses([SEP30, OCT01, oct02], at('2026-10-03T16:00:00Z'))).toEqual([101, 102, 103]); // Saturday
  });
  it('keeps every bar on a market holiday with no bar for today (Thanksgiving 2026-11-26)', () => {
    const nov25 = bar('2026-11-25T14:30:00Z', 300);
    expect(completedDailyCloses([nov25], at('2026-11-26T15:00:00Z'))).toEqual([300]);
  });
  it('half day (closes 13:00 ET) is handled conservatively: a finished bar before 16:00 is dropped, never a forming one kept', () => {
    const nov27 = bar('2026-11-27T14:30:00Z', 301); // day after Thanksgiving, early close
    const nov25 = bar('2026-11-25T14:30:00Z', 300);
    expect(completedDailyCloses([nov25, nov27], at('2026-11-27T18:30:00Z'))).toEqual([300]); // 13:30 ET
  });
  it('a lone forming bar leaves nothing to compute from', () => {
    expect(completedDailyCloses([OCT01], at('2026-10-01T15:00:00Z'))).toEqual([]);
  });
  it('an empty list is empty, not null', () => {
    expect(completedDailyCloses([], at('2026-10-01T15:00:00Z'))).toEqual([]);
  });
  it('the cut constant is 16:00', () => {
    expect(MARKET_CLOSE_ET_MINUTES).toBe(960);
  });
});

describe('completedDailyCloses: fail closed', () => {
  const now = at('2026-10-01T20:30:00Z');
  it('rejects non-arrays', () => {
    for (const bad of [null, undefined, 5, 'x', {}, { bars: [] }]) expect(completedDailyCloses(bad, now)).toBeNull();
  });
  it('rejects a bar that is not an object', () => {
    expect(completedDailyCloses([SEP29, null], now)).toBeNull();
    expect(completedDailyCloses([SEP29, 5], now)).toBeNull();
  });
  it('rejects a null, NaN, infinite, zero, negative, or string close without skipping it', () => {
    for (const c of [null, undefined, NaN, Infinity, 0, -1, '102']) {
      expect(completedDailyCloses([SEP29, SEP30, { t: OCT01.t, c }], now)).toBeNull();
    }
  });
  it('rejects a missing, non-finite, zero, or string timestamp', () => {
    for (const t of [undefined, NaN, Infinity, 0, '1']) {
      expect(completedDailyCloses([SEP29, { t, c: 101 }], now)).toBeNull();
    }
  });
  it('rejects unsorted or duplicate timestamps', () => {
    expect(completedDailyCloses([SEP30, SEP29], now)).toBeNull();
    expect(completedDailyCloses([SEP29, SEP29], now)).toBeNull();
  });
  it('rejects a last bar dated after today (clock skew)', () => {
    expect(completedDailyCloses([SEP29, bar('2026-10-02T13:30:00Z', 103)], now)).toBeNull();
  });
  it('rejects an invalid clock', () => {
    expect(completedDailyCloses([SEP29], new Date('not a date'))).toBeNull();
  });
});

describe('completedDailyCloses: output', () => {
  const now = at('2026-10-01T15:00:00Z');
  it('is oldest first and leaves the input untouched', () => {
    const input = [SEP29, SEP30, OCT01];
    const copy = JSON.parse(JSON.stringify(input));
    expect(completedDailyCloses(input, now)).toEqual([100, 101]);
    expect(input).toEqual(copy);
  });
  it('feeds rsiSeries: 20 completed bars give 6 RSI values and the forming bar changes nothing', () => {
    const day = 24 * 3600;
    const start = sec('2026-09-02T13:30:00Z');
    const closes = [44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.10, 45.42, 45.84, 46.08, 45.89, 46.03, 45.61, 46.28, 46.28, 46.00, 46.03, 46.41, 46.22, 45.64];
    const bars = closes.map((c, i) => ({ t: start + i * day, c })); // 2026-09-02 .. 2026-09-21, all before now
    const forming = { t: sec('2026-10-01T13:30:00Z'), c: 9999 };
    const done = completedDailyCloses([...bars, forming], now);
    expect(done).toEqual(closes);
    expect(rsiSeries(done)).toHaveLength(6);
  });
});
