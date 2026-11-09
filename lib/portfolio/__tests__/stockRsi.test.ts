// lib/portfolio/__tests__/stockRsi.test.ts

import { describe, expect, it } from 'vitest';
import { completedDailyCloses } from '@/lib/indicators/completedBars';
import { rsiSeries } from '@/lib/indicators/rsi';
import { rsiAsOfLabel, stockRsiDirection, stockRsiFromBars } from '../stockRsi';

// Daily bars at 9:30 ET, one per weekday-ish day, far in the past so every bar is "completed".
const DAY = 86_400;
const START = Date.UTC(2026, 0, 5, 14, 30) / 1000; // 2026-01-05 14:30Z = 9:30 ET
function bars(closes: number[]) {
  return closes.map((c, i) => ({ t: START + i * DAY, o: c, h: c, l: c, c }));
}
const NOW = new Date('2026-11-07T18:00:00Z');

describe('stockRsiFromBars', () => {
  const closes = [100, 101, 102, 101, 103, 104, 103, 105, 106, 105, 107, 108, 107, 109, 110, 111, 109, 108, 107, 106, 105, 106, 107];

  it('matches the scan-card pipeline exactly (completed bars, Wilder RSI)', () => {
    const series = rsiSeries(completedDailyCloses(bars(closes), NOW))!;
    const out = stockRsiFromBars(bars(closes), NOW)!;
    expect(out.rsi).toBe(series[series.length - 1]);
    expect(out.previous).toBe(series[series.length - 2]);
  });

  it('returns null, never a made-up number, when there are too few bars', () => {
    expect(stockRsiFromBars(bars(closes.slice(0, 15)), NOW)).toBeNull(); // one RSI value only: no "previous"
    expect(stockRsiFromBars([], NOW)).toBeNull();
  });

  it('returns null for malformed input', () => {
    expect(stockRsiFromBars(null, NOW)).toBeNull();
    expect(stockRsiFromBars([{ t: 1, c: 'x' }], NOW)).toBeNull();
  });

  it('drops the still-forming bar while the market is open', () => {
    const open = new Date('2026-01-26T16:00:00Z'); // 11:00 ET
    const todayBar = { t: Date.UTC(2026, 0, 26, 14, 30) / 1000, o: 1, h: 1, l: 1, c: 1 };
    const history = bars(closes).map((b, i) => ({ ...b, t: Date.UTC(2026, 0, 2 + i, 14, 30) / 1000 }));
    const withToday = [...history, todayBar];
    // the 11:00 ET partial bar (close 1) must not move the number
    expect(stockRsiFromBars(withToday, open)!.rsi).toBe(stockRsiFromBars(history, open)!.rsi);
  });
});

describe('rsiAsOfLabel', () => {
  it('names the last completed bar by weekday and date', () => {
    const points = [{ date: '2026-11-05', rsi: 31 }, { date: '2026-11-06', rsi: 29.95 }];
    expect(rsiAsOfLabel(points)).toEqual({ short: 'Fri close', long: 'Fri 11/6' });
  });

  it('is null with no points or a malformed date, never a guess', () => {
    expect(rsiAsOfLabel(undefined)).toBeNull();
    expect(rsiAsOfLabel([])).toBeNull();
    expect(rsiAsOfLabel([{ date: 'nope', rsi: 1 }])).toBeNull();
  });
});

describe('stockRsiDirection', () => {
  it('reads up, down and flat, with a one-point flat band', () => {
    expect(stockRsiDirection(47, 44)).toBe('up');
    expect(stockRsiDirection(44, 47)).toBe('down');
    expect(stockRsiDirection(47.4, 46.6)).toBe('flat');
    expect(stockRsiDirection(47, 46)).toBe('up'); // exactly one point is not flat
  });
});
