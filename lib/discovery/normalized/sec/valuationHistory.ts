// lib/discovery/normalized/sec/valuationHistory.ts

// LEAPS-QV-0001 Gate 2b (Section 12) -- historical P/E observations and distribution metrics. Metrics only.
//
// Observations: one TTM diluted EPS per reported fiscal period, tagged with the date it was FIRST published
// (`availableFrom`) so a valuation on day D uses only periods already public on D. Values are the latest-filed
// (restated) ones, which keeps them aligned with split-adjusted prices; the cost is that restatements are visible to
// older observations (documented limitation).
//
// Splits: a split is restated in later filings only for the periods they show as comparatives, so older periods keep
// pre-split EPS and share counts. A jump of 1.8x or more (either way) in the weighted-average diluted share count
// between consecutive reported periods is treated as a probable unrestated split (or a comparable share-structure
// change) and EVERY OLDER observation is excluded: fail closed, never rescaled.
// Negative / zero EPS days are excluded from distributions ("near-zero" has no ruling yet, so only <= 0 is excluded).
//
// Distribution metrics are computed from DAILY closes over a 3 or 5 year window and only when the window is genuinely
// covered (data-sufficiency rule below). Percentile = inclusive rank: the share of valid daily P/Es <= the current P/E.

import { invalidMetric, normalizeNumberMetric, unavailableMetric } from '../../metrics';
import type { MetricSet, NormalizedMetric } from '../../metrics';
import { isoFromEpochSeconds } from '../dates';
import { barsProblem, TECHNICAL_MAX_BAR_AGE_MS } from '../technicals';
import type { DailyBar } from '../technicals';
import { SEC_ITEMS } from './conceptMap';
import { resolveItemAt } from './facts';
import type { FactIndex } from './facts';
import { ttmAt } from './periods';
import type { Anchor } from './periods';

/** A share-count move of at least this factor between consecutive periods is treated as a probable split. */
export const SPLIT_SUSPECT_RATIO = 1.8;
/** Share of window trading days that must have a valid P/E (data sufficiency, not an investment threshold). */
export const PE_HISTORY_MIN_VALID_SHARE = 0.75;
/** The first valid P/E must fall within this many days of the window start (history must span the window). */
export const PE_HISTORY_START_SLACK_DAYS = 90;
/** Observations older than this many days before the newest period are not built. */
export const OBSERVATION_LOOKBACK_DAYS = 365 * 7 + 60;

export interface PeObservation {
  readonly periodEnd: string;
  readonly availableFrom: string;
  readonly epsTtm: number;
  readonly dilutedShares: number;
}

export interface ExcludedObservation {
  readonly periodEnd: string;
  readonly reason: 'SHARES_LEVEL_MISSING' | 'SPLIT_OR_SHARE_STRUCTURE_CHANGE_SUSPECTED';
}

export interface ObservationSet {
  readonly observations: readonly PeObservation[];
  readonly excluded: readonly ExcludedObservation[];
}

export function buildPeObservations(index: FactIndex, anchors: readonly Anchor[], daysBetween: (a: string, b: string) => number): ObservationSet {
  if (anchors.length === 0) return { observations: [], excluded: [] };
  const newest = anchors[anchors.length - 1].end;
  const raw: Array<{ periodEnd: string; availableFrom: string; epsTtm: number; shares: number | null }> = [];
  anchors.forEach((anchor) => {
    if (daysBetween(anchor.end, newest) > OBSERVATION_LOOKBACK_DAYS) return;
    const eps = ttmAt(index, SEC_ITEMS.dilutedEps, anchor, anchors);
    if (eps.status !== 'OK') return;
    const current = eps.pieces.find((p) => p.role === 'FY' || p.role === 'YTD_CURRENT');
    if (!current || current.resolved.status !== 'OK') return;
    const shares = resolveItemAt(index, SEC_ITEMS.dilutedShares, anchor.start, anchor.end);
    raw.push({
      periodEnd: anchor.end,
      availableFrom: current.resolved.firstFiled,
      epsTtm: eps.value,
      shares: shares.status === 'OK' && shares.value > 0 ? shares.value : null,
    });
  });
  raw.sort((a, b) => (a.periodEnd < b.periodEnd ? -1 : a.periodEnd > b.periodEnd ? 1 : 0));

  const excluded: ExcludedObservation[] = [];
  let cutoffIndex = -1;
  for (let i = 1; i < raw.length; i += 1) {
    const before = raw[i - 1].shares;
    const after = raw[i].shares;
    if (before === null || after === null) continue;
    const ratio = after / before;
    if (ratio >= SPLIT_SUSPECT_RATIO || ratio <= 1 / SPLIT_SUSPECT_RATIO) cutoffIndex = i - 1;
  }
  const observations: PeObservation[] = [];
  raw.forEach((row, i) => {
    if (i <= cutoffIndex) return void excluded.push({ periodEnd: row.periodEnd, reason: 'SPLIT_OR_SHARE_STRUCTURE_CHANGE_SUSPECTED' });
    if (row.shares === null) return void excluded.push({ periodEnd: row.periodEnd, reason: 'SHARES_LEVEL_MISSING' });
    observations.push({ periodEnd: row.periodEnd, availableFrom: row.availableFrom, epsTtm: row.epsTtm, dilutedShares: row.shares });
  });
  return { observations, excluded };
}

/**
 * Sign convention for every `*_discount_to_median_*_pct` metric (Ian, G2b-B1): positive = DISCOUNT (cheaper than the
 * historical median), zero = at the median, negative = PREMIUM (more expensive). ((median - current) / median) x 100.
 */
export function discountToMedianPct(current: number, median: number): number {
  return ((median - current) / median) * 100;
}

export const PE_HISTORY_METRIC_IDS: readonly string[] = [
  'pe_ttm_median_3y',
  'pe_ttm_median_5y',
  'pe_ttm_percentile_3y',
  'pe_ttm_percentile_5y',
  'pe_ttm_discount_to_median_3y_pct',
  'pe_ttm_discount_to_median_5y_pct',
];

const WINDOWS: ReadonlyArray<{ years: number; suffix: '3y' | '5y' }> = [
  { years: 3, suffix: '3y' },
  { years: 5, suffix: '5y' },
];

function median(sorted: readonly number[]): number {
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function allMetrics(make: (id: string) => NormalizedMetric): MetricSet {
  const out: Record<string, NormalizedMetric> = {};
  PE_HISTORY_METRIC_IDS.forEach((id) => {
    out[id] = make(id);
  });
  return out;
}

export interface PeHistoryArgs {
  readonly observations: readonly PeObservation[];
  readonly closes: readonly DailyBar[] | null;
  /** The current trailing P/E metric; the distribution metrics are only as valid as this one. */
  readonly peNow: NormalizedMetric;
  readonly now: string;
}

export function buildPeHistoryMetrics(args: PeHistoryArgs): MetricSet {
  const provenance = { provider: 'sec-edgar' };
  const { observations, closes, peNow, now } = args;
  if (!closes || closes.length === 0) return allMetrics((id) => unavailableMetric(id, 'NO_PRICE_HISTORY', provenance));
  const problem = barsProblem(closes);
  if (problem) return allMetrics((id) => invalidMetric(id, 'closes', problem, provenance));
  if (peNow.validity !== 'VALID') {
    return allMetrics((id) =>
      peNow.validity === 'INVALID'
        ? invalidMetric(id, 'pe_ttm', 'INPUT_INVALID:pe_ttm', provenance)
        : unavailableMetric(id, `INPUT_${peNow.validity}:pe_ttm`, provenance),
    );
  }
  const current = peNow.value as number;
  const last = closes[closes.length - 1];
  const asOf = isoFromEpochSeconds(last.t);
  const out: Record<string, NormalizedMetric> = {};
  const ordered = [...observations].sort((a, b) => (a.availableFrom < b.availableFrom ? -1 : a.availableFrom > b.availableFrom ? 1 : 0));

  WINDOWS.forEach(({ years, suffix }) => {
    const medianId = `pe_ttm_median_${suffix}`;
    const percentileId = `pe_ttm_percentile_${suffix}`;
    const discountId = `pe_ttm_discount_to_median_${suffix}_pct`;
    const fail = (reason: string) => {
      out[medianId] = unavailableMetric(medianId, reason, provenance);
      out[percentileId] = unavailableMetric(percentileId, reason, provenance);
      out[discountId] = unavailableMetric(discountId, reason, provenance);
    };
    const windowStart = last.t - years * 365 * 86400;
    if (closes[0].t > windowStart + 10 * 86400) return fail('INSUFFICIENT_PRICE_HISTORY');
    const windowBars = closes.filter((bar) => bar.t >= windowStart);
    const valid: number[] = [];
    let firstValidT: number | null = null;
    let pointer = -1;
    windowBars.forEach((bar) => {
      const date = isoFromEpochSeconds(bar.t).slice(0, 10);
      while (pointer + 1 < ordered.length && ordered[pointer + 1].availableFrom <= date) pointer += 1;
      if (pointer < 0) return;
      const eps = ordered[pointer].epsTtm;
      if (!(eps > 0)) return;
      valid.push(bar.c / eps);
      if (firstValidT === null) firstValidT = bar.t;
    });
    if (valid.length === 0 || valid.length / windowBars.length < PE_HISTORY_MIN_VALID_SHARE || firstValidT === null || firstValidT > windowStart + PE_HISTORY_START_SLACK_DAYS * 86400) {
      return fail('INSUFFICIENT_VALID_HISTORY');
    }
    const sorted = [...valid].sort((a, b) => a - b);
    const med = median(sorted);
    const atOrBelow = sorted.filter((v) => v <= current).length;
    const ctx = { asOf, now, maxAgeMs: TECHNICAL_MAX_BAR_AGE_MS, provenance };
    out[medianId] = normalizeNumberMetric(medianId, med, ctx);
    out[percentileId] = normalizeNumberMetric(percentileId, (atOrBelow / sorted.length) * 100, ctx);
    out[discountId] = normalizeNumberMetric(discountId, discountToMedianPct(current, med), ctx);
  });
  return out;
}
