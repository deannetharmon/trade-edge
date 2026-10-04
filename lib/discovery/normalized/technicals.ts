// lib/discovery/normalized/technicals.ts

// LEAPS-QV-0001 Gate 2 (Section 16 inputs) -- technical METRICS derived from daily closes. No states, no thresholds:
// classifying DECLINING / OVERSOLD / STABILIZING / RECOVERING is Gate 3.
//
// Input bars must be COMPLETED daily bars (the caller drops the still-forming bar, as lib/indicators/completedBars
// does for the existing RSI gate). Closes are split-adjusted and dividend-UNADJUSTED, matching /api/chart-history.
// Weekly and monthly series are resampled here; the final period counts only when `asOf` is in a LATER period than
// the last bar, so a half-finished week or month never feeds a weekly/monthly RSI.
// Nothing is repaired: unordered, duplicate, non-positive or non-finite bars make every technical INVALID.
//
// Wilder RSI(14) is restated here (not imported) because lib/discovery stays dependency-free; a fixed-vector test
// pins it to the same values as lib/indicators/rsi.ts.

import { invalidMetric, normalizeNumberMetric, unavailableMetric } from '../metrics';
import type { MetricSet, NormalizedMetric } from '../metrics';
import { epochDay, epochDayOfIso, isoFromEpochSeconds, mondayOfEpochDay, monthIndexOfEpochDay } from './dates';
import { latestCompletedSession, sessionCloseEpochSeconds } from './exchangeCalendar';

export interface DailyBar {
  /** Unix SECONDS of the session open. */
  readonly t: number;
  readonly c: number;
}

export const RSI_PERIOD = 14;
/** Data freshness for a daily-bar metric: covers a weekend plus a holiday. A data rule, not an investment rule. */
export const TECHNICAL_MAX_BAR_AGE_MS = 7 * 24 * 60 * 60 * 1000;
export const SMA_SHORT_PERIOD = 50;
export const SMA_LONG_PERIOD = 200;
export const SMA_SLOPE_LOOKBACK_BARS = 20;
export const RSI_WEEKLY_SLOPE_LOOKBACK = 4;
export const RELATIVE_RETURN_LOOKBACK_BARS = 126;
/** Gate 2c: the direction metrics compare "now" with 20 completed sessions ago (four trading weeks). */
export const DIRECTION_LOOKBACK_BARS = 20;
/** Weekly evidence legitimately lags the evaluation time by up to one week (the last COMPLETED week), so its freshness window is longer. */
export const WEEKLY_EVIDENCE_MAX_AGE_MS = TECHNICAL_MAX_BAR_AGE_MS + 7 * 24 * 60 * 60 * 1000;
/** The price basis every QV-v1.0 price-return metric uses for BOTH the stock and the benchmark. */
export const PRICE_BASIS_QUOTE = 'QUOTE_SPLIT_ADJUSTED_DIVIDEND_UNADJUSTED';
export const BENCHMARK_SYMBOL = 'SPY';
export const HIGH_WINDOW_DAYS = 365;
/** Bars required before a 52-week figure is trusted (one year of trading days, minus slack for holidays). */
export const HIGH_MIN_BARS = 240;

/** Why a series cannot be used at all; null when it is sound. */
export function barsProblem(bars: unknown): string | null {
  if (!Array.isArray(bars)) return 'BARS_NOT_AN_ARRAY';
  let previous = -Infinity;
  for (const bar of bars as DailyBar[]) {
    if (!bar || typeof bar.t !== 'number' || !Number.isFinite(bar.t)) return 'BAR_TIME_INVALID';
    if (typeof bar.c !== 'number' || !Number.isFinite(bar.c) || bar.c <= 0) return 'BAR_CLOSE_INVALID';
    if (bar.t <= previous) return 'BARS_NOT_STRICTLY_ASCENDING';
    previous = bar.t;
  }
  return null;
}

export function simpleMovingAverage(closes: readonly number[], period: number): number | null {
  if (!Number.isInteger(period) || period < 1 || closes.length < period) return null;
  let sum = 0;
  for (let i = closes.length - period; i < closes.length; i += 1) sum += closes[i];
  return sum / period;
}

function toRsi(avgGain: number, avgLoss: number): number {
  if (avgGain === 0 && avgLoss === 0) return 50;
  if (avgLoss === 0) return 100;
  if (avgGain === 0) return 0;
  return 100 - 100 / (1 + avgGain / avgLoss);
}

/** Wilder RSI(14) series for closes[14..n-1], oldest first; null when fewer than 15 closes. */
export function wilderRsiSeries(closes: readonly number[]): number[] | null {
  if (closes.length < RSI_PERIOD + 1) return null;
  let gains = 0;
  let losses = 0;
  for (let i = 1; i <= RSI_PERIOD; i += 1) {
    const change = closes[i] - closes[i - 1];
    if (change > 0) gains += change;
    else losses -= change;
  }
  let avgGain = gains / RSI_PERIOD;
  let avgLoss = losses / RSI_PERIOD;
  const out: number[] = [toRsi(avgGain, avgLoss)];
  for (let i = RSI_PERIOD + 1; i < closes.length; i += 1) {
    const change = closes[i] - closes[i - 1];
    avgGain = (avgGain * (RSI_PERIOD - 1) + (change > 0 ? change : 0)) / RSI_PERIOD;
    avgLoss = (avgLoss * (RSI_PERIOD - 1) + (change < 0 ? -change : 0)) / RSI_PERIOD;
    out.push(toRsi(avgGain, avgLoss));
  }
  return out;
}

export type Period = 'WEEK' | 'MONTH';

/**
 * Closes of COMPLETED weeks (Monday-based) or calendar months. The last period is dropped unless `asOfEpochDay`
 * falls in a later period than the last bar.
 */
export function periodCloses(bars: readonly DailyBar[], period: Period, asOfEpochDay: number): number[] {
  return periodObservations(bars, period, asOfEpochDay).map((observation) => observation.c);
}

/** As periodCloses, but each period carries the time of its LAST bar (the evidence time of that observation). */
export function periodObservations(bars: readonly DailyBar[], period: Period, asOfEpochDay: number): DailyBar[] {
  const keyOf = (day: number): number => (period === 'WEEK' ? mondayOfEpochDay(day) : monthIndexOfEpochDay(day));
  const observations: DailyBar[] = [];
  let currentKey: number | null = null;
  bars.forEach((bar) => {
    const key = keyOf(epochDay(bar.t));
    if (key !== currentKey) {
      observations.push({ t: bar.t, c: bar.c });
      currentKey = key;
    } else {
      observations[observations.length - 1] = { t: bar.t, c: bar.c };
    }
  });
  if (bars.length > 0 && keyOf(asOfEpochDay) <= keyOf(epochDay(bars[bars.length - 1].t))) observations.pop();
  return observations;
}

export interface TechnicalContext {
  /** Evaluation time (ISO-8601). */
  readonly now: string;
  readonly provider: string;
  readonly maxAgeMs?: number;
  /** Gate 2c: price basis of the stock series and of the benchmark series; a mismatch makes the benchmark metrics INVALID. */
  readonly priceBasis?: string;
  readonly benchmarkBasis?: string;
  /** Gate 2c: why no benchmark series is available (e.g. a failed SPY fetch); reported as the UNAVAILABLE reason. */
  readonly benchmarkUnavailableReason?: string | null;
}

export const TECHNICAL_METRIC_IDS: readonly string[] = [
  'price_last_close',
  'sma_50',
  'sma_200',
  'sma_200_change_20d_pct',
  'rsi_daily_14',
  'rsi_weekly_14',
  'rsi_weekly_change_4w',
  'rsi_monthly_14',
  'distance_from_52w_high_pct',
  'relative_return_126d_vs_benchmark_pct',
  // Gate 2c direction metrics (no thresholds; Gate 3 reads them).
  'rsi_weekly_slope_1w',
  'price_vs_sma50_gap_change_4w_pp',
  'relative_return_126d_change_4w_pp',
];

/** Gate 2c metrics that depend on the session calendar (completed-session semantics). */
export const DIRECTION_METRIC_IDS: readonly string[] = ['rsi_weekly_slope_1w', 'price_vs_sma50_gap_change_4w_pp', 'relative_return_126d_change_4w_pp'];

type SessionGuard = { readonly kind: 'OK' } | { readonly kind: 'UNAVAILABLE' | 'INVALID'; readonly reason: string };

/**
 * Exchange-calendar guard for the direction metrics (spec 6.2): the last bar must be a COMPLETED session and the LATEST completed
 * session at the evaluation instant. Calendar unknown -> UNAVAILABLE; a still-forming bar -> INVALID; a missing latest session ->
 * UNAVAILABLE. Nothing is guessed.
 */
function sessionGuard(last: DailyBar, nowIso: string): SessionGuard {
  const nowMs = Date.parse(nowIso);
  const lastDay = epochDay(last.t);
  const close = sessionCloseEpochSeconds(lastDay);
  const latest = Number.isFinite(nowMs) ? latestCompletedSession(nowMs / 1000) : null;
  if (close === null || latest === null) return { kind: 'UNAVAILABLE', reason: 'SESSION_CALENDAR_UNAVAILABLE' };
  if (close > nowMs / 1000) return { kind: 'INVALID', reason: 'FORMING_BAR_PRESENT' };
  if (lastDay !== latest) return { kind: 'UNAVAILABLE', reason: 'LATEST_COMPLETED_SESSION_MISSING' };
  return { kind: 'OK' };
}

/** gap(i) = (close[i] / SMA50 ending at i - 1) * 100, or null when fewer than 50 closes precede-and-include i. */
function smaGapPct(closes: readonly number[], index: number): number | null {
  if (index + 1 < SMA_SHORT_PERIOD) return null;
  let sum = 0;
  for (let i = index - SMA_SHORT_PERIOD + 1; i <= index; i += 1) sum += closes[i];
  return (closes[index] / (sum / SMA_SHORT_PERIOD) - 1) * 100;
}

function allWith(
  make: (id: string) => NormalizedMetric,
): MetricSet {
  const out: Record<string, NormalizedMetric> = {};
  TECHNICAL_METRIC_IDS.forEach((id) => {
    out[id] = make(id);
  });
  return out;
}

/**
 * Technical metrics from completed daily bars. `benchmark` (e.g. SPY bars) is optional; without it the relative
 * return is UNAVAILABLE. Every id in TECHNICAL_METRIC_IDS is always present in the result.
 */
export function buildTechnicalMetrics(
  bars: readonly DailyBar[] | null | undefined,
  context: TechnicalContext,
  benchmark?: readonly DailyBar[] | null,
): MetricSet {
  const provenance = { provider: context.provider, field: 'daily_close' };
  if (bars === null || bars === undefined || (Array.isArray(bars) && bars.length === 0)) {
    return allWith((id) => unavailableMetric(id, 'NO_PRICE_HISTORY', provenance));
  }
  const problem = barsProblem(bars);
  if (problem) return allWith((id) => invalidMetric(id, 'bars', problem, provenance));

  const nowDay = epochDayOfIso(context.now);
  if (nowDay === null) return allWith((id) => invalidMetric(id, context.now, 'EVALUATION_TIME_INVALID', provenance));

  const last = bars[bars.length - 1];
  const asOf = isoFromEpochSeconds(last.t);
  const closes = bars.map((bar) => bar.c);
  const priceBasis = context.priceBasis;
  const stockProvenance = priceBasis ? { ...provenance, priceBasis } : provenance;
  const benchmarkProvenance = { ...stockProvenance, benchmark: BENCHMARK_SYMBOL };
  const number = (
    id: string,
    value: number | null,
    reason: string,
    evidence?: { readonly asOf: string; readonly maxAgeMs: number; readonly provenance?: typeof provenance },
  ): NormalizedMetric => {
    const meta = evidence ? evidence.provenance || stockProvenance : stockProvenance;
    if (value === null) return unavailableMetric(id, reason, meta);
    if (!Number.isFinite(value)) return invalidMetric(id, value, 'NON_FINITE_RESULT', meta);
    return normalizeNumberMetric(id, value, {
      asOf: evidence ? evidence.asOf : asOf,
      now: context.now,
      maxAgeMs: evidence ? evidence.maxAgeMs : context.maxAgeMs ?? TECHNICAL_MAX_BAR_AGE_MS,
      provenance: meta,
    });
  };
  const basisMismatch = !!(context.priceBasis && context.benchmarkBasis && context.priceBasis !== context.benchmarkBasis);
  const noBenchmarkReason = context.benchmarkUnavailableReason || 'NO_BENCHMARK_HISTORY';

  const sma50 = simpleMovingAverage(closes, SMA_SHORT_PERIOD);
  const sma200 = simpleMovingAverage(closes, SMA_LONG_PERIOD);
  const prior200 = closes.length >= SMA_LONG_PERIOD + SMA_SLOPE_LOOKBACK_BARS
    ? simpleMovingAverage(closes.slice(0, closes.length - SMA_SLOPE_LOOKBACK_BARS), SMA_LONG_PERIOD)
    : null;

  const daily = wilderRsiSeries(closes);
  const weeklyCloses = periodCloses(bars, 'WEEK', nowDay);
  const weekly = wilderRsiSeries(weeklyCloses);
  const monthly = wilderRsiSeries(periodCloses(bars, 'MONTH', nowDay));

  let distance: number | null = null;
  const windowStart = last.t - HIGH_WINDOW_DAYS * 86400;
  const window = bars.filter((bar) => bar.t >= windowStart);
  const spansYear = bars[0].t <= windowStart + 5 * 86400;
  if (spansYear && window.length >= HIGH_MIN_BARS) {
    let high = 0;
    window.forEach((bar) => {
      if (bar.c > high) high = bar.c;
    });
    distance = (last.c / high - 1) * 100;
  }

  let relative: NormalizedMetric = unavailableMetric('relative_return_126d_vs_benchmark_pct', noBenchmarkReason, benchmarkProvenance);
  if (benchmark && benchmark.length > 0) {
    const benchProblem = barsProblem(benchmark);
    const benchLast = benchmark[benchmark.length - 1];
    if (basisMismatch) {
      relative = invalidMetric('relative_return_126d_vs_benchmark_pct', context.benchmarkBasis, 'ADJUSTMENT_BASIS_MISMATCH', benchmarkProvenance);
    } else if (benchProblem) {
      relative = invalidMetric('relative_return_126d_vs_benchmark_pct', 'benchmark', benchProblem, benchmarkProvenance);
    } else if (benchLast.t !== last.t) {
      relative = invalidMetric('relative_return_126d_vs_benchmark_pct', benchLast.t, 'BENCHMARK_NOT_ALIGNED_TO_LAST_BAR', benchmarkProvenance);
    } else if (bars.length <= RELATIVE_RETURN_LOOKBACK_BARS) {
      relative = unavailableMetric('relative_return_126d_vs_benchmark_pct', 'INSUFFICIENT_HISTORY', benchmarkProvenance);
    } else {
      const startBar = bars[bars.length - 1 - RELATIVE_RETURN_LOOKBACK_BARS];
      const benchStart = benchmark.find((bar) => bar.t === startBar.t);
      relative = benchStart
        ? number(
            'relative_return_126d_vs_benchmark_pct',
            (last.c / startBar.c - benchLast.c / benchStart.c) * 100,
            'INSUFFICIENT_HISTORY',
            { asOf, maxAgeMs: context.maxAgeMs ?? TECHNICAL_MAX_BAR_AGE_MS, provenance: benchmarkProvenance },
          )
        : invalidMetric('relative_return_126d_vs_benchmark_pct', startBar.t, 'BENCHMARK_NOT_ALIGNED_TO_START_BAR', benchmarkProvenance);
    }
  }

  // ---- Gate 2c direction metrics ----
  const guard = sessionGuard(last, context.now);
  const guarded = (id: string, benchmarkBased: boolean): NormalizedMetric | null => {
    if (guard.kind === 'OK') return null;
    const meta = benchmarkBased ? benchmarkProvenance : stockProvenance;
    return guard.kind === 'UNAVAILABLE' ? unavailableMetric(id, guard.reason, meta) : invalidMetric(id, last.t, guard.reason, meta);
  };

  // rsi_weekly_slope_1w: the last COMPLETED weekly step of the same weekly RSI series that feeds rsi_weekly_change_4w.
  const weeklyObservations = periodObservations(bars, 'WEEK', nowDay);
  const slopeEvidenceAsOf = weeklyObservations.length > 0 ? isoFromEpochSeconds(weeklyObservations[weeklyObservations.length - 1].t) : asOf;
  const slopeValue = weekly && weekly.length >= 2 ? weekly[weekly.length - 1] - weekly[weekly.length - 2] : null;
  const rsiWeeklySlope =
    guarded('rsi_weekly_slope_1w', false) ||
    number('rsi_weekly_slope_1w', slopeValue, 'INSUFFICIENT_HISTORY', { asOf: slopeEvidenceAsOf, maxAgeMs: context.maxAgeMs ? context.maxAgeMs + 7 * 86400000 : WEEKLY_EVIDENCE_MAX_AGE_MS });

  // price_vs_sma50_gap_change_4w_pp: gap(n-1) - gap(n-21), percentage points.
  const gapNow = smaGapPct(closes, closes.length - 1);
  const gapThen = smaGapPct(closes, closes.length - 1 - DIRECTION_LOOKBACK_BARS);
  const smaGapChange =
    guarded('price_vs_sma50_gap_change_4w_pp', false) ||
    number('price_vs_sma50_gap_change_4w_pp', gapNow !== null && gapThen !== null ? gapNow - gapThen : null, 'INSUFFICIENT_HISTORY');

  // relative_return_126d_change_4w_pp: R(n-1) - R(n-21), R(i) = (stock return - benchmark return over 126 bars ending i) * 100.
  const relativeChange: NormalizedMetric = (() => {
    const id = 'relative_return_126d_change_4w_pp';
    const early = guarded(id, true);
    if (early) return early;
    if (!benchmark || benchmark.length === 0) return unavailableMetric(id, noBenchmarkReason, benchmarkProvenance);
    if (basisMismatch) return invalidMetric(id, context.benchmarkBasis, 'ADJUSTMENT_BASIS_MISMATCH', benchmarkProvenance);
    const benchProblem = barsProblem(benchmark);
    if (benchProblem) return invalidMetric(id, 'benchmark', benchProblem, benchmarkProvenance);
    const benchLast = benchmark[benchmark.length - 1];
    if (benchLast.t !== last.t) return invalidMetric(id, benchLast.t, 'BENCHMARK_NOT_ALIGNED_TO_LAST_BAR', benchmarkProvenance);
    const needed = RELATIVE_RETURN_LOOKBACK_BARS + DIRECTION_LOOKBACK_BARS + 1;
    if (bars.length < needed) return unavailableMetric(id, 'INSUFFICIENT_HISTORY', benchmarkProvenance);
    const n = bars.length;
    // required stock indexes, and the benchmark close at EXACTLY the same timestamp (looked up by timestamp, never by position)
    const indexes = [n - 1, n - 1 - DIRECTION_LOOKBACK_BARS, n - 1 - RELATIVE_RETURN_LOOKBACK_BARS, n - 1 - DIRECTION_LOOKBACK_BARS - RELATIVE_RETURN_LOOKBACK_BARS];
    const benchByTime: Record<number, number> = {};
    benchmark.forEach((bar) => {
      benchByTime[bar.t] = bar.c;
    });
    const benchClose: number[] = [];
    for (const index of indexes) {
      const found = benchByTime[bars[index].t];
      if (found === undefined) return invalidMetric(id, bars[index].t, 'BENCHMARK_NOT_ALIGNED_TO_LOOKBACK_BAR', benchmarkProvenance);
      benchClose.push(found);
    }
    const relativeNow = (bars[indexes[0]].c / bars[indexes[2]].c - benchClose[0] / benchClose[2]) * 100;
    const relativeThen = (bars[indexes[1]].c / bars[indexes[3]].c - benchClose[1] / benchClose[3]) * 100;
    return number(id, relativeNow - relativeThen, 'INSUFFICIENT_HISTORY', { asOf, maxAgeMs: context.maxAgeMs ?? TECHNICAL_MAX_BAR_AGE_MS, provenance: benchmarkProvenance });
  })();

  const weeklyLast = weekly ? weekly[weekly.length - 1] : null;
  const weeklyPrior = weekly && weekly.length > RSI_WEEKLY_SLOPE_LOOKBACK ? weekly[weekly.length - 1 - RSI_WEEKLY_SLOPE_LOOKBACK] : null;

  const set: Record<string, NormalizedMetric> = {
    price_last_close: number('price_last_close', last.c, 'NO_PRICE_HISTORY'),
    sma_50: number('sma_50', sma50, 'INSUFFICIENT_HISTORY'),
    sma_200: number('sma_200', sma200, 'INSUFFICIENT_HISTORY'),
    sma_200_change_20d_pct: number(
      'sma_200_change_20d_pct',
      sma200 !== null && prior200 !== null ? (sma200 / prior200 - 1) * 100 : null,
      'INSUFFICIENT_HISTORY',
    ),
    rsi_daily_14: number('rsi_daily_14', daily ? daily[daily.length - 1] : null, 'INSUFFICIENT_HISTORY'),
    rsi_weekly_14: number('rsi_weekly_14', weeklyLast, 'INSUFFICIENT_HISTORY'),
    rsi_weekly_change_4w: number(
      'rsi_weekly_change_4w',
      weeklyLast !== null && weeklyPrior !== null ? weeklyLast - weeklyPrior : null,
      'INSUFFICIENT_HISTORY',
    ),
    rsi_monthly_14: number('rsi_monthly_14', monthly ? monthly[monthly.length - 1] : null, 'INSUFFICIENT_HISTORY'),
    distance_from_52w_high_pct: number('distance_from_52w_high_pct', distance, 'INSUFFICIENT_HISTORY'),
    relative_return_126d_vs_benchmark_pct: relative,
    rsi_weekly_slope_1w: rsiWeeklySlope,
    price_vs_sma50_gap_change_4w_pp: smaGapChange,
    relative_return_126d_change_4w_pp: relativeChange,
  };
  return set;
}
