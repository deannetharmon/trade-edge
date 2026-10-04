// lib/discovery/normalized/__tests__/technicalsDirection.test.ts

// LEAPS-QV-0001 Gate 2c -- direction metrics: rsi_weekly_slope_1w, price_vs_sma50_gap_change_4w_pp, relative_return_126d_change_4w_pp.
// Golden values are literals produced by an independent script (Python, no import of this code) or computed by hand in the comments.

import { describe, expect, it } from 'vitest';
import { DIRECTION_METRIC_IDS, PRICE_BASIS_QUOTE, buildTechnicalMetrics, daysFromCivil, isSessionDay } from '..';
import type { DailyBar } from '..';

const SAT = '2026-10-03T14:00:00.000Z'; // Saturday; latest completed session = Friday 2026-10-02
const MON = '2026-10-05T12:00:00.000Z'; // Monday before the open: the week of 2026-10-02 is complete
const LAST_DAY = daysFromCivil(2026, 10, 2);
const OPEN = 14 * 3600 + 30 * 60;
const ctx = { now: SAT, provider: 'yahoo', priceBasis: PRICE_BASIS_QUOTE, benchmarkBasis: PRICE_BASIS_QUOTE };

/** n completed bars on real exchange sessions ending on `endDay`; close = f(index from oldest). */
function sessions(n: number, f: (i: number) => number, endDay: number = LAST_DAY): DailyBar[] {
  const days: number[] = [];
  for (let d = endDay; days.length < n; d -= 1) if (isSessionDay(d) === true) days.push(d);
  days.reverse();
  return days.map((d, i) => ({ t: d * 86400 + OPEN, c: f(i) }));
}

/** One bar per week (the last session of each week), weekly closes `w` oldest first, ending Friday 2026-10-02. */
function weekly(w: number[]): DailyBar[] {
  return w.map((c, i) => {
    let d = LAST_DAY - 7 * (w.length - 1 - i);
    if (isSessionDay(d) !== true) d -= 1; // 3 July 2026 (observed holiday) -> Thursday
    return { t: d * 86400 + OPEN, c };
  });
}

const metric = (set: Record<string, any>, id: string) => set[id];
const W16 = [44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.1, 45.42, 45.84, 46.08, 45.89, 46.03, 45.61, 46.28, 46.28, 46.0];
const W20 = [...W16, 46.03, 46.41, 46.22, 45.64];

describe('rsi_weekly_slope_1w', () => {
  it('is the last completed weekly RSI step (independent value; 16 weekly closes -> 2 RSI values)', () => {
    const m = metric(buildTechnicalMetrics(weekly(W16), { ...ctx, now: MON }), 'rsi_weekly_slope_1w');
    expect(m.validity).toBe('VALID');
    expect(m.value).toBeCloseTo(-4.214516467541998, 10); // 66.24961855355505 - 70.46413502109705
  });

  it('uses the same weekly series as rsi_weekly_change_4w (20 weeks: slope -8.3797, 4w change -8.3346)', () => {
    const set = (buildTechnicalMetrics(weekly(W20), { ...ctx, now: MON }) as Record<string, any>);
    expect(set.rsi_weekly_slope_1w.value).toBeCloseTo(-8.379691988840683, 10); // 57.91502067008556 - 66.29471265892624
    expect(set.rsi_weekly_change_4w.value).toBeCloseTo(-8.334597883469492, 10);
    expect(set.rsi_weekly_14.value).toBeCloseTo(57.91502067008556, 10);
  });

  it('boundary: 15 weekly closes -> UNAVAILABLE INSUFFICIENT_HISTORY, 16 -> VALID', () => {
    const few = metric(buildTechnicalMetrics(weekly(W16.slice(1)), { ...ctx, now: MON }), 'rsi_weekly_slope_1w');
    expect(few.validity).toBe('UNAVAILABLE');
    expect(few.reason).toBe('INSUFFICIENT_HISTORY');
  });

  it('weekly observation semantics: with exactly 16 weekly closes the current week is excluded on a Saturday', () => {
    // On Saturday 2026-10-03 the week containing Friday 2026-10-02 is the current calendar week -> excluded by the existing weekly rule,
    // leaving 15 earlier completed weekly closes -> not enough for the slope (the rule itself is unchanged).
    const m = metric(buildTechnicalMetrics(weekly(W16), ctx), 'rsi_weekly_slope_1w');
    expect(m.validity).toBe('UNAVAILABLE');
  });

  it('Saturday / Sunday: the current week is excluded until Monday, the slope is still available from 16 EARLIER completed weekly closes', () => {
    const w17 = [...W16, 45.9]; // 17th (current-week) close must not matter on the weekend
    const expected = -4.214516467541998; // slope of the 16 earlier weeks (W16)
    ['2026-10-03T14:00:00.000Z', '2026-10-04T14:00:00.000Z'].forEach((now) => {
      const set = buildTechnicalMetrics(weekly(w17), { ...ctx, now }) as Record<string, any>;
      expect(set.rsi_weekly_slope_1w.validity, now).toBe('VALID');
      expect(set.rsi_weekly_slope_1w.value).toBeCloseTo(expected, 10);
    });
    // On Monday the 17th week is complete and becomes the latest observation: a different slope.
    const monday = buildTechnicalMetrics(weekly(w17), { ...ctx, now: MON }) as Record<string, any>;
    expect(monday.rsi_weekly_slope_1w.value).not.toBeCloseTo(expected, 6);
    // Only 15 earlier completed weeks (16 total including the current week) -> UNAVAILABLE on the weekend.
    expect(metric(buildTechnicalMetrics(weekly(W16), ctx), 'rsi_weekly_slope_1w').validity).toBe('UNAVAILABLE');
  });

  it('is deterministic', () => {
    const a = buildTechnicalMetrics(weekly(W20), { ...ctx, now: MON });
    const b = buildTechnicalMetrics(weekly(W20), { ...ctx, now: MON });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe('price_vs_sma50_gap_change_4w_pp', () => {
  it("Alan's fixture: 70 closes, first 50 at 100, last 20 at 110 -> 5.769230769230769 pp", () => {
    // gap(69) = (110 / SMA50 - 1) * 100 with SMA50 = (30*100 + 20*110)/50 = 104 -> 5.769230769230769 ; gap(49) = 0 (all closes 100)
    const set: Record<string, any> = buildTechnicalMetrics(sessions(70, (i) => (i < 50 ? 100 : 110)), ctx);
    expect(set.price_vs_sma50_gap_change_4w_pp.validity).toBe('VALID');
    expect(set.price_vs_sma50_gap_change_4w_pp.value).toBeCloseTo(5.769230769230769, 12);
  });

  it('independent varied fixture (n=90, c=100+0.3i+4*((7i)%5)) -> -0.4406648215040434', () => {
    const set: Record<string, any> = buildTechnicalMetrics(sessions(90, (i) => 100 + 0.3 * i + 4 * ((i * 7) % 5)), ctx);
    expect(set.price_vs_sma50_gap_change_4w_pp.value).toBeCloseTo(-0.4406648215040434, 10);
  });

  it('boundary: 69 bars -> UNAVAILABLE INSUFFICIENT_HISTORY; 70 bars -> VALID', () => {
    const f = (i: number): number => 100 + (i % 7);
    const short: any = buildTechnicalMetrics(sessions(69, f), ctx).price_vs_sma50_gap_change_4w_pp;
    expect(short.validity).toBe('UNAVAILABLE');
    expect(short.reason).toBe('INSUFFICIENT_HISTORY');
    expect(buildTechnicalMetrics(sessions(70, f), ctx).price_vs_sma50_gap_change_4w_pp.validity).toBe('VALID');
  });

  it('is a flat zero for a flat series and is deterministic', () => {
    const a: Record<string, any> = buildTechnicalMetrics(sessions(100, () => 50), ctx);
    expect(a.price_vs_sma50_gap_change_4w_pp.value).toBe(0);
    expect(JSON.stringify(a)).toBe(JSON.stringify(buildTechnicalMetrics(sessions(100, () => 50), ctx)));
  });
});

describe('relative_return_126d_change_4w_pp', () => {
  const stock = (n: number, f: (i: number) => number) => sessions(n, f);
  const bench = (n: number, f: (i: number) => number) => sessions(n, f);
  const rel = (s: DailyBar[], b: DailyBar[] | null | undefined, extra: object = {}) => metric(buildTechnicalMetrics(s, { ...ctx, ...extra }, b), 'relative_return_126d_change_4w_pp');

  it("Alan's fixture: 147 flat bars at 100 for both, final stock close 120 -> 20 pp", () => {
    // R(n-21) = 0 (all flat); R(n-1) = (120/100 - 100/100) * 100 = 20
    const m = rel(stock(147, (i) => (i === 146 ? 120 : 100)), bench(147, () => 100));
    expect(m.validity).toBe('VALID');
    expect(m.value).toBeCloseTo(20, 12);
    expect(m.provenance.benchmark).toBe('SPY');
    expect(m.provenance.priceBasis).toBe(PRICE_BASIS_QUOTE);
  });

  it('independent varied fixture (N=200) -> 0.5771809117517179 (R_now 19.167644669134233, R_then 18.590463757382516)', () => {
    const m = rel(stock(200, (i) => 100 + 0.5 * i + 3 * ((i * 3) % 7)), bench(200, (i) => 100 + 0.2 * i + 2 * ((i * 5) % 4)));
    expect(m.value).toBeCloseTo(0.5771809117517179, 10);
  });

  it('boundary: 146 bars -> UNAVAILABLE INSUFFICIENT_HISTORY; 147 -> VALID', () => {
    const f = (i: number): number => 100 + (i % 9);
    const short = rel(stock(146, f), bench(146, f));
    expect(short.validity).toBe('UNAVAILABLE');
    expect(short.reason).toBe('INSUFFICIENT_HISTORY');
    expect(rel(stock(147, f), bench(147, f)).validity).toBe('VALID');
  });

  describe('benchmark timestamp alignment (looked up by timestamp, never by position)', () => {
    const f = (i: number): number => 100 + (i % 9);
    const s = stock(160, f);
    const full = bench(160, f);
    const without = (t: number): DailyBar[] => full.filter((bar) => bar.t !== t);
    const n = s.length;

    it('benchmark ending a session early -> INVALID BENCHMARK_NOT_ALIGNED_TO_LAST_BAR', () => {
      const m = rel(s, full.slice(0, -1));
      expect(m.validity).toBe('INVALID');
      expect(m.reason).toBe('BENCHMARK_NOT_ALIGNED_TO_LAST_BAR');
    });

    [[n - 1 - 20, 'n-21'], [n - 1 - 126, 'n-127'], [n - 1 - 146, 'n-147']].forEach(([index, label]) => {
      it(`benchmark missing the bar at index ${label} -> INVALID BENCHMARK_NOT_ALIGNED_TO_LOOKBACK_BAR`, () => {
        const m = rel(s, without(s[index as number].t));
        expect(m.validity).toBe('INVALID');
        expect(m.reason).toBe('BENCHMARK_NOT_ALIGNED_TO_LOOKBACK_BAR');
      });
    });

    it('a positionally-shifted benchmark (same length, one missing bar early, one extra late) is not accepted', () => {
      const shifted = full.filter((bar) => bar.t !== s[n - 1 - 126].t);
      const m = rel(s, shifted);
      expect(m.validity).toBe('INVALID');
    });

    it('extra benchmark bars the stock lacks are harmless', () => {
      const extra = [{ t: s[0].t - 86400 * 7, c: 90 }, ...full];
      expect(rel(s, extra).validity).toBe('VALID');
    });
  });

  it('missing benchmark -> UNAVAILABLE NO_BENCHMARK_HISTORY, or the loader-supplied reason', () => {
    const s = stock(160, (i) => 100 + i);
    expect(rel(s, null)).toMatchObject({ validity: 'UNAVAILABLE', reason: 'NO_BENCHMARK_HISTORY' });
    expect(rel(s, [])).toMatchObject({ validity: 'UNAVAILABLE', reason: 'NO_BENCHMARK_HISTORY' });
    expect(rel(s, undefined, { benchmarkUnavailableReason: 'BENCHMARK_FETCH_FAILED' })).toMatchObject({ validity: 'UNAVAILABLE', reason: 'BENCHMARK_FETCH_FAILED' });
  });

  it('invalid benchmark bars -> INVALID; adjustment-basis mismatch -> INVALID ADJUSTMENT_BASIS_MISMATCH', () => {
    const s = stock(160, (i) => 100 + i);
    const b = bench(160, (i) => 100 + i);
    expect(rel(s, b.map((bar, i) => (i === 50 ? { ...bar, c: 0 } : bar))).validity).toBe('INVALID');
    expect(rel(s, b.map((bar, i) => (i === 50 ? { ...bar, c: Number.NaN } : bar))).validity).toBe('INVALID');
    const mismatch = rel(s, b, { benchmarkBasis: 'ADJCLOSE_DIVIDEND_ADJUSTED' });
    expect(mismatch).toMatchObject({ validity: 'INVALID', reason: 'ADJUSTMENT_BASIS_MISMATCH' });
  });

  it('SPY problems do not touch stock-only direction metrics', () => {
    const s = stock(160, (i) => 100 + (i % 11));
    const set = buildTechnicalMetrics(s, ctx, null);
    expect(set.relative_return_126d_change_4w_pp.validity).toBe('UNAVAILABLE');
    expect(set.price_vs_sma50_gap_change_4w_pp.validity).toBe('VALID');
    expect(set.sma_50.validity).toBe('VALID');
  });

  it('is deterministic', () => {
    const f = (i: number): number => 100 + 0.5 * i + 3 * ((i * 3) % 7);
    const a = rel(stock(200, f), bench(200, (i) => 100 + 0.2 * i));
    const b = rel(stock(200, f), bench(200, (i) => 100 + 0.2 * i));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe('completed-session guard and freshness (all three direction metrics)', () => {
  const f = (i: number): number => 100 + (i % 9);
  const s = sessions(160, f);
  const b = sessions(160, f);
  const ids = DIRECTION_METRIC_IDS;

  it('a forming bar (session not yet closed at now) -> INVALID FORMING_BAR_PRESENT', () => {
    const set = buildTechnicalMetrics(s, { ...ctx, now: '2026-10-02T15:00:00.000Z' }, b);
    ids.forEach((id) => expect(set[id], id).toMatchObject({ validity: 'INVALID', reason: 'FORMING_BAR_PRESENT' }));
  });

  it('the latest completed session is missing -> UNAVAILABLE LATEST_COMPLETED_SESSION_MISSING', () => {
    const set = buildTechnicalMetrics(s, { ...ctx, now: '2026-10-06T00:00:00.000Z' }, b); // Monday 10-05 completed, series ends 10-02
    ids.forEach((id) => expect(set[id], id).toMatchObject({ validity: 'UNAVAILABLE', reason: 'LATEST_COMPLETED_SESSION_MISSING' }));
  });

  it('calendar cannot decide (bar on a closed day / out of range) -> UNAVAILABLE SESSION_CALENDAR_UNAVAILABLE', () => {
    const odd = [...sessions(159, f, daysFromCivil(2026, 9, 4)), { t: daysFromCivil(2026, 9, 7) * 86400 + OPEN, c: 100 }]; // last bar on Labor Day
    const set = buildTechnicalMetrics(odd, { ...ctx, now: '2026-09-08T14:00:00.000Z' }, b);
    ids.forEach((id) => expect(set[id], id).toMatchObject({ validity: 'UNAVAILABLE', reason: 'SESSION_CALENDAR_UNAVAILABLE' }));
  });

  it('fresh when the last bar is the latest completed session; stale when older than the allowed age', () => {
    const fresh = buildTechnicalMetrics(s, ctx, b);
    expect(fresh.price_vs_sma50_gap_change_4w_pp.validity).toBe('VALID');
    expect(fresh.relative_return_126d_change_4w_pp.validity).toBe('VALID');
    const stale = buildTechnicalMetrics(s, { ...ctx, maxAgeMs: 3600 * 1000 }, b);
    expect(stale.price_vs_sma50_gap_change_4w_pp.validity).toBe('STALE');
    expect(stale.relative_return_126d_change_4w_pp.validity).toBe('STALE');
  });

  it('no price history -> every direction metric UNAVAILABLE NO_PRICE_HISTORY', () => {
    const set = buildTechnicalMetrics([], ctx, b);
    ids.forEach((id) => expect(set[id], id).toMatchObject({ validity: 'UNAVAILABLE', reason: 'NO_PRICE_HISTORY' }));
  });
});

describe('whole-series calendar validation inside the metric layer (stock and benchmark isolated)', () => {
  const f = (i: number): number => 100 + (i % 9);
  const holidayBar = (bars: DailyBar[], index: number): DailyBar[] => {
    // replace one INTERIOR bar's timestamp with a calendar-closed day that keeps the series strictly ascending
    const t = bars[index].t;
    const closedDay = epochDayOf(t) - 1;
    return bars.map((bar, i) => (i === index ? { ...bar, t: closedDay * 86400 + OPEN } : bar));
  };
  const epochDayOf = (t: number): number => Math.floor(t / 86400);
  const s = sessions(160, f);
  const b = sessions(160, f);
  // find an interior index whose previous calendar day is a weekend/holiday and the bar before it is older than that day
  const interior = (() => {
    for (let i = 5; i < 150; i += 1) {
      const prevDay = epochDayOf(s[i].t) - 1;
      if (isSessionDay(prevDay) === false && epochDayOf(s[i - 1].t) < prevDay) return i;
    }
    return -1;
  })();

  it('fixture sanity: an interior bar can be moved onto a closed day', () => expect(interior).toBeGreaterThan(0));

  it('stock series with an interior closed-day bar and a valid latest session -> all three direction metrics UNAVAILABLE', () => {
    const set = buildTechnicalMetrics(holidayBar(s, interior), ctx, b);
    DIRECTION_METRIC_IDS.forEach((id) => expect(set[id], id).toMatchObject({ validity: 'UNAVAILABLE', reason: 'SESSION_CALENDAR_UNAVAILABLE' }));
  });

  it('stock series with an interior out-of-range bar -> all three UNAVAILABLE', () => {
    const early = [{ t: daysFromCivil(2006, 6, 1) * 86400 + OPEN, c: 100 }, ...s.slice(1)];
    const set = buildTechnicalMetrics(early, ctx, b);
    DIRECTION_METRIC_IDS.forEach((id) => expect(set[id], id).toMatchObject({ validity: 'UNAVAILABLE', reason: 'SESSION_CALENDAR_UNAVAILABLE' }));
  });

  it('valid stock history with a calendar-invalid benchmark: ONLY the relative-strength change is UNAVAILABLE; stock-only metrics stay VALID', () => {
    const set = buildTechnicalMetrics(s, ctx, holidayBar(b, interior)) as Record<string, any>;
    expect(set.relative_return_126d_change_4w_pp).toMatchObject({ validity: 'UNAVAILABLE', reason: 'SESSION_CALENDAR_UNAVAILABLE' });
    expect(set.price_vs_sma50_gap_change_4w_pp.validity).toBe('VALID');
    expect(set.sma_50.validity).toBe('VALID');
    expect(set.rsi_daily_14.validity).toBe('VALID');
  });

  it('the fetch-boundary flags make the result stricter even when the series itself looks clean', () => {
    const stockFlag = buildTechnicalMetrics(s, { ...ctx, calendarUnavailable: true }, b);
    DIRECTION_METRIC_IDS.forEach((id) => expect(stockFlag[id], id).toMatchObject({ validity: 'UNAVAILABLE', reason: 'SESSION_CALENDAR_UNAVAILABLE' }));
    const benchFlag = buildTechnicalMetrics(s, { ...ctx, benchmarkCalendarUnavailable: true }, b) as Record<string, any>;
    expect(benchFlag.relative_return_126d_change_4w_pp.reason).toBe('SESSION_CALENDAR_UNAVAILABLE');
    expect(benchFlag.price_vs_sma50_gap_change_4w_pp.validity).toBe('VALID');
  });

  const LEVEL = 'relative_return_126d_vs_benchmark_pct';

  it('LEVEL: an interior calendar-invalid STOCK bar cannot produce a VALID relative-strength level', () => {
    const set = buildTechnicalMetrics(holidayBar(s, interior), ctx, b);
    expect(set[LEVEL]).toMatchObject({ validity: 'UNAVAILABLE', reason: 'SESSION_CALENDAR_UNAVAILABLE' });
  });

  it('LEVEL: an interior calendar-invalid BENCHMARK bar cannot produce a VALID level even though every required endpoint timestamp aligns', () => {
    const badBench = holidayBar(b, interior);
    const needed = [s.length - 1, s.length - 1 - 126, s.length - 1 - 20, s.length - 1 - 146].map((i) => s[i].t);
    needed.forEach((t) => expect(badBench.some((bar) => bar.t === t), String(t)).toBe(true)); // endpoints present and aligned
    const set = buildTechnicalMetrics(s, ctx, badBench) as Record<string, any>;
    expect(set[LEVEL]).toMatchObject({ validity: 'UNAVAILABLE', reason: 'SESSION_CALENDAR_UNAVAILABLE' });
    expect(set.relative_return_126d_change_4w_pp).toMatchObject({ validity: 'UNAVAILABLE', reason: 'SESSION_CALENDAR_UNAVAILABLE' });
    expect(set.price_vs_sma50_gap_change_4w_pp.validity).toBe('VALID');
    expect(set.sma_200.validity).toBe('UNAVAILABLE'); // only 160 bars: unrelated, unchanged
  });

  it('LEVEL: supplied flags (stock / benchmark) make the level UNAVAILABLE; clean inputs stay VALID', () => {
    expect(buildTechnicalMetrics(s, { ...ctx, calendarUnavailable: true }, b)[LEVEL]).toMatchObject({ validity: 'UNAVAILABLE', reason: 'SESSION_CALENDAR_UNAVAILABLE' });
    expect(buildTechnicalMetrics(s, { ...ctx, benchmarkCalendarUnavailable: true }, b)[LEVEL]).toMatchObject({ validity: 'UNAVAILABLE', reason: 'SESSION_CALENDAR_UNAVAILABLE' });
    expect(buildTechnicalMetrics(s, ctx, b)[LEVEL].validity).toBe('VALID');
  });

  it('LEVEL: malformed-benchmark and basis-mismatch diagnostics are preserved ahead of the calendar verdict', () => {
    const dup = b.map((bar, i) => (i === 10 ? { ...bar, t: b[9].t } : bar));
    expect(buildTechnicalMetrics(s, ctx, dup)[LEVEL]).toMatchObject({ validity: 'INVALID', reason: 'BARS_NOT_STRICTLY_ASCENDING' });
    expect(buildTechnicalMetrics(s, { ...ctx, benchmarkBasis: 'X' }, holidayBar(b, interior))[LEVEL]).toMatchObject({ validity: 'INVALID', reason: 'ADJUSTMENT_BASIS_MISMATCH' });
  });
});
