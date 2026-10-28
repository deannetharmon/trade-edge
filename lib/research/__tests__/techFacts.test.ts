// lib/research/__tests__/techFacts.test.ts

import { describe, expect, it } from 'vitest';
import { atr14, horizonReturns, keyLevels, rangeExtremes, relativeStrength, strikeContext, volumeRatio, type FactBar } from '../techFacts';
import { buildResearchFacts, completedBars } from '../researchFacts';

const DAY = 86_400;
const T0 = Date.UTC(2026, 0, 5, 14, 30) / 1000; // a past Monday 9:30 ET

function flat(n: number, over: Partial<Record<number, Partial<FactBar>>> = {}, base = { o: 100, h: 101, l: 99, c: 100 }): FactBar[] {
  return Array.from({ length: n }, (_, i) => ({ t: T0 + i * DAY, ...base, ...(over[i] ?? {}) }));
}
const fromCloses = (closes: number[]): FactBar[] => closes.map((c, i) => ({ t: T0 + i * DAY, o: c, h: c, l: c, c }));

describe('RESEARCH-0002 techFacts', () => {
  it('ATR(14): constant 2-point ranges give exactly 2; a gap uses the previous close', () => {
    expect(atr14(flat(15, {}, { o: 10, h: 11, l: 9, c: 10 }))).toBe(2);
    expect(atr14(flat(40, {}, { o: 10, h: 11, l: 9, c: 10 }))).toBe(2);
    // bar 15 gaps up: h 21, l 20, prior close 10 -> TR 11; ATR = (2*13 + 11) / 14
    const gap = flat(15, {}, { o: 10, h: 11, l: 9, c: 10 }).concat([{ t: T0 + 15 * DAY, o: 20, h: 21, l: 20, c: 20 }]);
    expect(atr14(gap)).toBeCloseTo((2 * 13 + 11) / 14, 10);
  });
  it('fails closed on short, unordered, non-positive or malformed bars', () => {
    expect(atr14(flat(14))).toBeNull();
    expect(atr14([...flat(20)].reverse())).toBeNull();
    expect(atr14(flat(20, { 5: { l: 0 } }))).toBeNull();
    expect(atr14(flat(20, { 5: { h: 90 } }))).toBeNull();
    expect(atr14('nope')).toBeNull();
    expect(keyLevels(flat(59))).toBeNull();
  });
  it('key levels: two near pivot lows merge into one support with 2 touches; the pivot high is the resistance', () => {
    const bars = flat(80, { 20: { l: 90 }, 50: { l: 90.2 }, 35: { h: 110 } });
    const lv = keyLevels(bars)!;
    expect(lv.supports).toHaveLength(1);
    expect(lv.supports[0].touches).toBe(2);
    expect(lv.supports[0].price).toBeCloseTo(90.1, 6);
    expect(lv.supports[0].lastTouchT).toBe(T0 + 50 * DAY);
    expect(lv.resistances).toEqual([{ price: 110, touches: 1, lastTouchT: T0 + 35 * DAY }]);
  });
  it('key levels: pivots in the last 3 bars are not confirmed', () => {
    const lv = keyLevels(flat(80, { 78: { l: 80 } }))!;
    expect(lv.supports).toHaveLength(0);
  });
  it('range extremes: 20-day and 250-day high/low need no confirmation; null without enough bars', () => {
    const bars = flat(300, { 299: { h: 120 }, 100: { l: 70 }, 290: { l: 95 } });
    expect(rangeExtremes(bars)).toEqual({ high20: 120, low20: 95, high52w: 120, low52w: 70 });
    expect(rangeExtremes(flat(30, { 5: { h: 150 } }))).toEqual({ high20: 101, low20: 99, high52w: null, low52w: null });
    expect(rangeExtremes([])).toEqual({ high20: null, low20: null, high52w: null, low52w: null });
  });
  it('volume ratio: 20-day average over 60-day average; null when volume is missing', () => {
    const bars = flat(60).map((b, i) => ({ ...b, v: i < 40 ? 100 : 200 }));
    expect(volumeRatio(bars)).toBeCloseTo(200 / ((40 * 100 + 20 * 200) / 60), 10);
    expect(volumeRatio(flat(60))).toBeNull();
    expect(volumeRatio(flat(59).map(b => ({ ...b, v: 1 })))).toBeNull();
  });
  it('relative strength: return difference over the same 126 sessions, null if the series end on different days', () => {
    const n = 130;
    const stock = fromCloses(Array.from({ length: n }, (_, i) => (i <= n - 1 - 126 ? 100 : 100 + ((i - (n - 1 - 126)) * 30) / 126)));
    const spy = fromCloses(Array.from({ length: n }, (_, i) => (i <= n - 1 - 126 ? 100 : 100 + ((i - (n - 1 - 126)) * 10) / 126)));
    const rs = relativeStrength(stock, spy)!;
    expect(rs.stockPct).toBeCloseTo(30, 8);
    expect(rs.benchmarkPct).toBeCloseTo(10, 8);
    expect(rs.diffPts).toBeCloseTo(20, 8);
    expect(relativeStrength(stock, spy.slice(0, -1))).toBeNull();
    expect(relativeStrength(stock.slice(-100), spy.slice(-100))).toBeNull();
  });
  it('horizon returns: 21, 63 and 126 sessions back, null when the history is too short', () => {
    const closes = Array.from({ length: 130 }, (_, i) => 100 + i); // last = 229
    const r = horizonReturns(fromCloses(closes));
    expect(r.m1).toBeCloseTo(((229 - 208) / 208) * 100, 10);
    expect(r.m3).toBeCloseTo(((229 - 166) / 166) * 100, 10);
    expect(r.m6).toBeCloseTo(((229 - 103) / 103) * 100, 10);
    const short = horizonReturns(fromCloses(closes.slice(0, 50)));
    expect(short.m1).toBeCloseTo(((149 - 128) / 128) * 100, 10);
    expect(short.m3).toBeNull();
    expect(short.m6).toBeNull();
    expect(horizonReturns([])).toEqual({ m1: null, m3: null, m6: null });
  });
  it('strike context: percent and ATRs below price, and the nearest support at or below the strike', () => {
    const levels = { supports: [{ price: 97, touches: 1, lastTouchT: 1 }, { price: 93, touches: 2, lastTouchT: 2 }], resistances: [] };
    const c = strikeContext(95, 100, 2.5, levels)!;
    expect(c.pctBelowPrice).toBe(5);
    expect(c.atrsBelowPrice).toBe(2);
    expect(c.nearestSupportBelowStrike!.price).toBe(93);
    expect(c.nearestSupportBelowStrike!.pctBelowStrike).toBeCloseTo((2 / 95) * 100, 10);
    expect(strikeContext(95, 100, null, null)).toEqual({ pctBelowPrice: 5, atrsBelowPrice: null, nearestSupportBelowStrike: null });
    expect(strikeContext(0, 100, 2, levels)).toBeNull();
  });
});

describe('RESEARCH-0002 researchFacts', () => {
  const past = new Date('2026-10-27T20:00:00Z');
  it('keeps every bar when all are complete', () => {
    expect(completedBars(flat(70), past)).toHaveLength(70);
  });
  it('drops exactly the still-forming last bar (today, before 4pm ET)', () => {
    const today = Date.UTC(2026, 9, 27, 13, 30) / 1000; // 9:30 ET today
    const bars = flat(70).map((b, i) => ({ ...b, t: today - (69 - i) * DAY }));
    const out = completedBars(bars, new Date('2026-10-27T15:00:00Z'))!; // 11:00 ET
    expect(out).toHaveLength(69);
    expect(out[out.length - 1].t).toBe(today - DAY);
  });
  it('builds the facts and is null for unusable input', () => {
    const f = buildResearchFacts('XYZ', flat(130).map(b => ({ ...b, v: 10 })), flat(130), past)!;
    expect(f).toMatchObject({ symbol: 'XYZ', price: 100, volumeRatio: 1 });
    expect(f.atr14).toBeCloseTo(2, 10);
    expect(f.relativeStrength!.diffPts).toBeCloseTo(0, 10);
    expect(buildResearchFacts('XYZ', [], flat(130), past)).toBeNull();
  });
});
