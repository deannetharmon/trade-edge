// lib/discovery/normalized/sec/fcfHistory.ts

// LEAPS-QV-0001 Gate 2c (spec section 8) -- `fcf_annual_history_5y`: annual free cash flow, oldest first, from the SAME SEC
// per-fiscal-year resolution that feeds `annualSeries` (identical concept map, period and ambiguity rules; FCF = operating
// cash flow - capital expenditure, the formula of `fcf_ttm`). Data only: no threshold, no pattern, no classification.
//
// Usable history = the LATEST CONTIGUOUS SUFFIX of fiscal years ending at the newest fiscal year (up to 5 points):
//  * Consecutive means the fiscal-year ends are 357-378 days apart (52-week = 364, 53-week = 371, calendar = 365/366).
//  * The newest year must have FCF. If it does not, the metric is UNAVAILABLE: an older year is never substituted.
//  * The newest three years are required: a missing item / ambiguity / calendar gap inside them stops the metric
//    (UNAVAILABLE `SEC_ITEM_NOT_REPORTED:<item>` or `INSUFFICIENT_HISTORY`; ambiguity or a negative capex outflow is INVALID).
//  * Older years extend the suffix only while they are consecutive and complete; an older gap simply ends the suffix and does not
//    invalidate three or more good recent years. Nothing is bridged or interpolated.
//  * Restated periods use the latest filing (resolveItemAt) and are flagged in provenance.
// `asOf` is the latest filing date used in the SEC result (the same `filedMax` stamp as the other SEC metrics); freshness is the
// SEC-metric rule (FUNDAMENTALS_MAX_AGE_MS).

import { invalidMetric, normalizeMetric, unavailableMetric } from '../../metrics';
import type { NormalizedMetric } from '../../metrics';
import { FUNDAMENTALS_MAX_AGE_MS } from '../fundamentals';
import { SEC_ITEMS } from './conceptMap';
import { provenanceOf, resolveItemAt } from './facts';
import type { FactIndex, Resolved } from './facts';
import { dayOf } from './periods';
import type { FiscalYear } from './periods';
import type { SecProvenance } from './types';

export const FCF_HISTORY_METRIC_ID = 'fcf_annual_history_5y';
export const FCF_HISTORY_MAX_POINTS = 5;
export const FCF_HISTORY_MIN_POINTS = 3;
/** Fiscal-year ends this many days apart are consecutive years (52/53-week and calendar years). */
export const FISCAL_YEAR_GAP_MIN_DAYS = 357;
export const FISCAL_YEAR_GAP_MAX_DAYS = 378;
/** Annual points the SEC annualSeries (and therefore this history) looks back over. */
const ANNUAL_LOOKBACK_YEARS = 10;

const PROVENANCE = { provider: 'sec-edgar' };

type YearFcf =
  | { readonly status: 'OK'; readonly value: number; readonly pieces: readonly SecProvenance[]; readonly filedMax: string }
  | { readonly status: 'UNAVAILABLE'; readonly reason: string }
  | { readonly status: 'INVALID'; readonly reason: string };

function pieceOf(resolved: Resolved, fy: FiscalYear): SecProvenance | null {
  return provenanceOf(resolved, `FY_${fy.end}`);
}

function fcfOfYear(index: FactIndex, fy: FiscalYear): YearFcf {
  const operatingCashFlow = resolveItemAt(index, SEC_ITEMS.operatingCashFlow, fy.start, fy.end);
  const capex = resolveItemAt(index, SEC_ITEMS.capex, fy.start, fy.end);
  for (const [item, resolved] of [['operatingCashFlow', operatingCashFlow], ['capex', capex]] as Array<[string, Resolved]>) {
    if (resolved.status === 'AMBIGUOUS') return { status: 'INVALID', reason: `AMBIGUOUS_CONCEPT:${item}` };
  }
  for (const [item, resolved] of [['operatingCashFlow', operatingCashFlow], ['capex', capex]] as Array<[string, Resolved]>) {
    if (resolved.status === 'MISSING') return { status: 'UNAVAILABLE', reason: `SEC_ITEM_NOT_REPORTED:${item}` };
  }
  const ocf = operatingCashFlow as Extract<Resolved, { status: 'OK' }>;
  const cap = capex as Extract<Resolved, { status: 'OK' }>;
  if (cap.value < 0) return { status: 'INVALID', reason: 'CAPEX_MUST_BE_A_POSITIVE_OUTFLOW' };
  const pieces: SecProvenance[] = [];
  [ocf, cap].forEach((resolved) => {
    const piece = pieceOf(resolved, fy);
    if (piece) pieces.push(piece);
  });
  const filedMax = pieces.reduce((max, piece) => (piece.filed > max ? piece.filed : max), '');
  return { status: 'OK', value: ocf.value - cap.value, pieces, filedMax };
}

export interface FcfHistoryResult {
  readonly metric: NormalizedMetric;
  /** One entry per fiscal-year item used (empty unless the metric is VALID or STALE). */
  readonly provenance: readonly SecProvenance[];
}

/**
 * `fiscalYears` are the SEC fiscal years oldest first (findFiscalYears). `datasetFiledMax` is the latest filing date used anywhere
 * in the same SEC result (the `filedMax` every other SEC metric is stamped with); the metric's own filing dates never move it earlier,
 * so annual history is judged by the same freshness clock as the rest of the SEC dataset ("as other SEC metrics").
 */
export function buildFcfAnnualHistory(index: FactIndex, fiscalYears: readonly FiscalYear[], now: string, datasetFiledMax = ''): FcfHistoryResult {
  const id = FCF_HISTORY_METRIC_ID;
  const fail = (metric: NormalizedMetric): FcfHistoryResult => ({ metric, provenance: [] });
  const years = fiscalYears.slice(Math.max(0, fiscalYears.length - ANNUAL_LOOKBACK_YEARS));
  if (years.length === 0) return fail(unavailableMetric(id, 'INSUFFICIENT_HISTORY', PROVENANCE));

  const newestFirst: number[] = [];
  const yearPieces: Array<readonly SecProvenance[]> = [];
  let filedMax = '';
  let previousEnd: string | null = null;
  for (let position = years.length - 1; position >= 0 && newestFirst.length < FCF_HISTORY_MAX_POINTS; position -= 1) {
    const fy = years[position];
    const required = newestFirst.length < FCF_HISTORY_MIN_POINTS;
    if (previousEnd !== null) {
      const gap = dayOf(previousEnd) - dayOf(fy.end);
      if (gap < FISCAL_YEAR_GAP_MIN_DAYS || gap > FISCAL_YEAR_GAP_MAX_DAYS) {
        if (required) return fail(unavailableMetric(id, 'INSUFFICIENT_HISTORY', PROVENANCE));
        break;
      }
    }
    const year = fcfOfYear(index, fy);
    if (year.status !== 'OK') {
      if (!required) break;
      return fail(year.status === 'INVALID' ? invalidMetric(id, 'n/a', year.reason, PROVENANCE) : unavailableMetric(id, year.reason, PROVENANCE));
    }
    newestFirst.push(year.value);
    yearPieces.push(year.pieces);
    if (year.filedMax > filedMax) filedMax = year.filedMax;
    previousEnd = fy.end;
  }
  if (newestFirst.length < FCF_HISTORY_MIN_POINTS) return fail(unavailableMetric(id, 'INSUFFICIENT_HISTORY', PROVENANCE));

  const history = newestFirst.slice().reverse(); // oldest first
  const metric = normalizeMetric<number[]>(id, history, {
    asOf: `${datasetFiledMax > filedMax ? datasetFiledMax : filedMax}T00:00:00.000Z`,
    now,
    maxAgeMs: FUNDAMENTALS_MAX_AGE_MS,
    provenance: PROVENANCE,
    coerce: (raw) => {
      if (!Array.isArray(raw) || raw.some((entry) => typeof entry !== 'number' || !Number.isFinite(entry))) return { ok: false, reason: 'NOT_A_LIST_OF_FINITE_NUMBERS' };
      return { ok: true, value: raw as number[] };
    },
  });
  const ordered: SecProvenance[] = [];
  yearPieces.slice().reverse().forEach((list) => list.forEach((piece) => ordered.push(piece))); // oldest year first
  return { metric, provenance: metric.validity === 'VALID' || metric.validity === 'STALE' ? ordered : [] };
}
