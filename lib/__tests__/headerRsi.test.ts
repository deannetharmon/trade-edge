// lib/__tests__/headerRsi.test.ts
//
// OPTMAP-0001 S6: the header RSI is the existing pipelines' numbers, and never a guess.

import { describe, it, expect } from 'vitest';
import { headerRsiFromBars, formatRsi, completedWeeklyCloses } from '@/lib/trademap/headerRsi';
import { stockRsiFromBars } from '@/lib/portfolio/stockRsi';
import { rsiSeries } from '@/lib/indicators/rsi';

// Weekday bars from Mon 2025-01-06, one per weekday, 16:00 UTC (11:00 ET), with a wavy price path.
const START = Date.UTC(2025, 0, 6, 16, 0, 0) / 1000;
function weekdayBars(n: number) {
  const bars: Array<{ t: number; o: number; h: number; l: number; c: number }> = [];
  let day = 0;
  while (bars.length < n) {
    const t = START + day * 86400;
    const dow = new Date(t * 1000).getUTCDay();
    if (dow !== 0 && dow !== 6) {
      const c = 100 + 8 * Math.sin(bars.length / 7) + bars.length * 0.05;
      bars.push({ t, o: c, h: c + 1, l: c - 1, c });
    }
    day += 1;
  }
  return bars;
}

describe('headerRsiFromBars', () => {
  const bars = weekdayBars(300);
  const now = new Date((bars[bars.length - 1].t + 3 * 86400) * 1000); // the Monday after the last bar, midday UTC

  it('daily equals the screener-card pipeline', () => {
    const r = headerRsiFromBars(bars, bars.map(b => ({ t: b.t, c: b.c })), now);
    expect(r.daily).toBe(stockRsiFromBars(bars, now)!.rsi);
  });
  it('weekly equals Wilder RSI on the closes of completed Monday-based weeks', () => {
    const long = bars.map(b => ({ t: b.t, c: b.c }));
    const r = headerRsiFromBars(bars, long, now);
    // Independent reference: the Friday close of each full week (the series starts on a Monday and has no holidays).
    const fridays = long.filter(b => new Date(b.t * 1000).getUTCDay() === 5).map(b => b.c);
    const series = rsiSeries(fridays)!;
    expect(r.weekly).toBeCloseTo(series[series.length - 1], 10);
    expect(r.weekly).toBeGreaterThan(0);
    expect(r.weekly).toBeLessThan(100);
  });
  it('a half-finished week is not used', () => {
    const long = bars.map(b => ({ t: b.t, c: b.c }));
    const last = long[long.length - 1];
    const lastDow = new Date(last.t * 1000).getUTCDay();
    const sameDay = last.t + 3600;
    const monday = last.t + 3 * 86400;
    const midWeek = completedWeeklyCloses(long, sameDay)!;
    const nextWeek = completedWeeklyCloses(long, monday)!;
    expect(lastDow).toBe(5); // the series ends on a Friday
    expect(midWeek.length).toBe(nextWeek.length - 1);
    expect(nextWeek[nextWeek.length - 1]).toBe(last.c); // the Friday close counts once the next week has begun
  });
  it('malformed, unsorted or duplicate bars give no weekly series', () => {
    expect(completedWeeklyCloses([{ t: 2, c: 1 }, { t: 1, c: 1 }], 10_000_000)).toBeNull();
    expect(completedWeeklyCloses([{ t: 1, c: 1 }, { t: 1, c: 1 }], 10_000_000)).toBeNull();
    expect(completedWeeklyCloses([{ t: 1, c: 0 }], 10_000_000)).toBeNull();
    expect(completedWeeklyCloses(null, 1)).toBeNull();
  });
  it('too little history gives dashes, not guesses', () => {
    const few = weekdayBars(30);
    const r = headerRsiFromBars(few, few.map(b => ({ t: b.t, c: b.c })), new Date((few[few.length - 1].t + 3 * 86400) * 1000));
    expect(r.weekly).toBeNull();
    expect(headerRsiFromBars(null, null, now)).toEqual({ daily: null, weekly: null });
    expect(headerRsiFromBars('x', [{ t: 1, c: -5 }], now)).toEqual({ daily: null, weekly: null });
  });
  it('formats a value or a dash', () => {
    expect(formatRsi(52.4)).toBe('52');
    expect(formatRsi(57.6)).toBe('58');
    expect(formatRsi(null)).toBe('—');
    expect(formatRsi(NaN)).toBe('—');
  });
});
