// lib/discovery/normalized/__tests__/technicals.test.ts

import { describe, expect, it } from 'vitest';
import {
  TECHNICAL_METRIC_IDS,
  barsProblem,
  buildTechnicalMetrics,
  daysFromCivil,
  isSessionDay,
  periodCloses,
  simpleMovingAverage,
  wilderRsiSeries,
} from '..';
import type { DailyBar } from '..';

const NOW = '2026-10-03T14:00:00.000Z'; // a Saturday
const LAST_DAY = daysFromCivil(2026, 10, 2); // Friday
const OPEN = 14 * 3600 + 30 * 60;
const ctx = { now: NOW, provider: 'yahoo' };

/** n completed business-day bars ending on `endDay` (a weekday); close = f(index from oldest). */
function bars(n: number, f: (i: number) => number, endDay: number = LAST_DAY): DailyBar[] {
  const days: number[] = [];
  for (let d = endDay; days.length < n; d -= 1) {
    const wd = (((d + 4) % 7) + 7) % 7;
    if (wd !== 0 && wd !== 6) days.push(d);
  }
  days.reverse();
  return days.map((d, i) => ({ t: d * 86400 + OPEN, c: f(i) }));
}

/** Like bars() but only on real exchange sessions (the relative-return level now requires calendar-valid series). */
function sessionBars(n: number, f: (i: number) => number, endDay: number = LAST_DAY): DailyBar[] {
  const days: number[] = [];
  for (let d = endDay; days.length < n; d -= 1) if (isSessionDay(d) === true) days.push(d);
  days.reverse();
  return days.map((d, i) => ({ t: d * 86400 + OPEN, c: f(i) }));
}

function value(set: Record<string, any>, id: string): number {
  const m = set[id];
  expect(m.validity, `${id}: ${JSON.stringify(m)}`).toBe('VALID');
  return m.value;
}

describe('wilder RSI parity with lib/indicators/rsi.ts', () => {
  it('matches the reference vector produced by the existing implementation', () => {
    const closes = [44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.1, 45.42, 45.84, 46.08, 45.89, 46.03, 45.61, 46.28, 46.28, 46.0, 46.03, 46.41, 46.22, 45.64];
    const expected = [70.46413502109705, 66.24961855355505, 66.48094183471265, 69.34685316290866, 66.29471265892624, 57.91502067008556];
    const series = wilderRsiSeries(closes)!;
    expect(series).toHaveLength(expected.length);
    series.forEach((v, i) => expect(v).toBeCloseTo(expected[i], 10));
  });

  it('needs 15 closes and handles flat / one-way series like the existing code', () => {
    expect(wilderRsiSeries(new Array(14).fill(10))).toBeNull();
    expect(wilderRsiSeries(new Array(15).fill(10))).toEqual([50]);
    expect(wilderRsiSeries(Array.from({ length: 20 }, (_, i) => 10 + i))!.pop()).toBe(100);
    expect(wilderRsiSeries(Array.from({ length: 20 }, (_, i) => 30 - i))!.pop()).toBe(0);
  });
});

describe('helpers', () => {
  it('simple moving average of the last n closes', () => {
    expect(simpleMovingAverage([1, 2, 3, 4, 5], 3)).toBe(4);
    expect(simpleMovingAverage([1, 2], 3)).toBeNull();
    expect(simpleMovingAverage([1, 2], 0)).toBeNull();
  });

  it('rejects unordered, duplicate, non-positive and non-finite bars', () => {
    expect(barsProblem([{ t: 2, c: 1 }, { t: 1, c: 1 }])).toBe('BARS_NOT_STRICTLY_ASCENDING');
    expect(barsProblem([{ t: 1, c: 1 }, { t: 1, c: 1 }])).toBe('BARS_NOT_STRICTLY_ASCENDING');
    expect(barsProblem([{ t: 1, c: 0 }])).toBe('BAR_CLOSE_INVALID');
    expect(barsProblem([{ t: 1, c: NaN }])).toBe('BAR_CLOSE_INVALID');
    expect(barsProblem([{ t: NaN, c: 1 }])).toBe('BAR_TIME_INVALID');
    expect(barsProblem('x')).toBe('BARS_NOT_AN_ARRAY');
    expect(barsProblem([{ t: 1, c: 1 }, { t: 2, c: 2 }])).toBeNull();
  });

  it('drops a still-forming week / month unless asOf is in a later period', () => {
    const monToWed = bars(3, (i) => 10 + i, daysFromCivil(2026, 9, 30)); // Mon 28 .. Wed 30 Sep 2026
    expect(periodCloses(monToWed, 'WEEK', daysFromCivil(2026, 9, 30))).toEqual([]);
    expect(periodCloses(monToWed, 'WEEK', daysFromCivil(2026, 10, 5))).toEqual([12]);
    expect(periodCloses(monToWed, 'MONTH', daysFromCivil(2026, 9, 30))).toEqual([]);
    expect(periodCloses(monToWed, 'MONTH', daysFromCivil(2026, 10, 1))).toEqual([12]);
  });

  it('uses the last bar of each week as that week close', () => {
    const two = bars(10, (i) => i + 1, daysFromCivil(2026, 10, 2)); // two full weeks Mon 21 Sep .. Fri 2 Oct
    expect(periodCloses(two, 'WEEK', daysFromCivil(2026, 10, 5))).toEqual([5, 10]);
  });
});

describe('buildTechnicalMetrics', () => {
  it('always returns every technical id', () => {
    [null, undefined, [], bars(5, () => 10), bars(700, (i) => 10 + i)].forEach((input) => {
      expect(Object.keys(buildTechnicalMetrics(input as any, ctx)).sort()).toEqual([...TECHNICAL_METRIC_IDS].sort());
    });
  });

  it('is UNAVAILABLE (never zero or neutral) with no history', () => {
    const set = buildTechnicalMetrics(null, ctx);
    Object.values(set).forEach((m) => {
      expect(m.validity).toBe('UNAVAILABLE');
      expect((m as any).reason).toBe('NO_PRICE_HISTORY');
    });
  });

  it('marks everything INVALID for a malformed series instead of repairing it', () => {
    const broken = bars(300, (i) => 10 + i);
    broken[100] = { t: broken[99].t, c: 5 };
    Object.values(buildTechnicalMetrics(broken, ctx)).forEach((m) => {
      expect(m.validity).toBe('INVALID');
      expect((m as any).reason).toBe('BARS_NOT_STRICTLY_ASCENDING');
    });
  });

  it('computes every metric from a long rising series', () => {
    const set = buildTechnicalMetrics(bars(700, (i) => 100 + i), ctx);
    expect(value(set, 'price_last_close')).toBe(799);
    expect(value(set, 'sma_50')).toBeCloseTo((799 + 750) / 2, 10);
    expect(value(set, 'sma_200')).toBeCloseTo((799 + 600) / 2, 10);
    expect(value(set, 'sma_200_change_20d_pct')).toBeGreaterThan(0);
    expect(value(set, 'rsi_daily_14')).toBe(100);
    expect(value(set, 'rsi_weekly_14')).toBe(100);
    expect(value(set, 'rsi_weekly_change_4w')).toBe(0);
    expect(value(set, 'rsi_monthly_14')).toBe(100);
    expect(value(set, 'distance_from_52w_high_pct')).toBe(0);
    expect(set.relative_return_126d_vs_benchmark_pct.validity).toBe('UNAVAILABLE');
  });

  it('reports INSUFFICIENT_HISTORY rather than shortening the window', () => {
    const set = buildTechnicalMetrics(bars(100, (i) => 100 + i), ctx);
    expect(value(set, 'sma_50')).toBeGreaterThan(0);
    ['sma_200', 'sma_200_change_20d_pct', 'rsi_monthly_14', 'distance_from_52w_high_pct'].forEach((id) => {
      expect(set[id].validity).toBe('UNAVAILABLE');
      expect((set[id] as any).reason).toBe('INSUFFICIENT_HISTORY');
    });
  });

  it('measures distance below the 52-week closing high', () => {
    const closes = (i: number) => (i <= 450 ? 100 + i : 550 - (i - 450) * 2); // peak 550 then falls
    const set = buildTechnicalMetrics(bars(500, closes), ctx);
    const last = closes(499);
    expect(value(set, 'distance_from_52w_high_pct')).toBeCloseTo((last / 550 - 1) * 100, 10);
  });

  it('does not let an old peak outside the 52-week window count', () => {
    const closes = (i: number) => (i < 100 ? 1000 : 100 + (i % 7));
    const set = buildTechnicalMetrics(bars(600, closes), ctx);
    expect(value(set, 'distance_from_52w_high_pct')).toBeGreaterThan(-15);
  });

  it('turns old data STALE, keeping the number out of value', () => {
    const old = bars(300, (i) => 100 + i, daysFromCivil(2026, 8, 28));
    const set = buildTechnicalMetrics(old, ctx);
    expect(set.price_last_close.validity).toBe('STALE');
    expect('value' in set.price_last_close).toBe(false);
    expect((set.price_last_close as any).staleValue).toBe(399);
  });

  it('rejects bars from the future', () => {
    const set = buildTechnicalMetrics(bars(300, (i) => 100 + i, daysFromCivil(2026, 10, 9)), ctx);
    expect(set.price_last_close.validity).toBe('INVALID');
  });

  it('rejects an invalid evaluation time', () => {
    const set = buildTechnicalMetrics(bars(300, (i) => 100 + i), { now: 'not a time', provider: 'yahoo' });
    expect(set.price_last_close.validity).toBe('INVALID');
  });

  it('excludes the forming week from weekly RSI', () => {
    const mid = { now: '2026-10-01T20:00:00.000Z', provider: 'yahoo' }; // Thursday: Mon-Wed bars exist, week incomplete
    const rising = bars(400, (i) => 100 + i, daysFromCivil(2026, 9, 30));
    const closed = bars(400, (i) => 100 + i, daysFromCivil(2026, 9, 25)); // ends Friday of the prior week
    const weeklyMid = value(buildTechnicalMetrics(rising, mid), 'rsi_weekly_14');
    const weeklyClosed = value(buildTechnicalMetrics(closed, { now: '2026-09-27T20:00:00.000Z', provider: 'yahoo' }), 'rsi_weekly_14');
    expect(weeklyMid).toBe(100);
    expect(weeklyClosed).toBe(100);
  });

  describe('relative return vs benchmark', () => {
    const stock = sessionBars(300, (i) => 100 * Math.pow(1.002, i));
    it('is the difference of the 126-bar returns', () => {
      const bench = sessionBars(300, () => 50);
      const set = buildTechnicalMetrics(stock, ctx, bench);
      const expected = (stock[299].c / stock[299 - 126].c - 1) * 100;
      expect(value(set, 'relative_return_126d_vs_benchmark_pct')).toBeCloseTo(expected, 10);
    });
    it('is INVALID when the benchmark is not aligned to the last bar', () => {
      const shifted = sessionBars(300, () => 50, daysFromCivil(2026, 10, 1));
      expect(buildTechnicalMetrics(stock, ctx, shifted).relative_return_126d_vs_benchmark_pct.validity).toBe('INVALID');
    });
    it('is INVALID when the benchmark is malformed and UNAVAILABLE when short', () => {
      const bad = sessionBars(300, () => 50);
      bad[10] = { t: bad[9].t, c: 1 };
      expect(buildTechnicalMetrics(stock, ctx, bad).relative_return_126d_vs_benchmark_pct.validity).toBe('INVALID');
      expect(buildTechnicalMetrics(sessionBars(100, () => 10), ctx, sessionBars(100, () => 10)).relative_return_126d_vs_benchmark_pct.validity).toBe('UNAVAILABLE');
    });
  });
});
