// lib/discovery/normalized/sec/periods.ts

// LEAPS-QV-0001 Gate 2b -- fiscal-period structure and trailing-twelve-month construction from SEC duration facts.
//
// A quarterly filing reports cumulative year-to-date durations (3, 6 and 9 months) and cash-flow items ONLY as
// year-to-date, so YTD facts must never be read as quarters. TTM is therefore built the standard way:
//   TTM(E) = FY(previous) + YTD(current, ending E) - YTD(prior year, ending ~E-1y)
// and at a fiscal-year end TTM(E) = FY(E). Periods are classified by their LENGTH IN DAYS (fy/fp on a fact describe the
// filing, not the period, and are not used). Fiscal calendars (non-December year ends, 52/53-week years) work because
// nothing assumes calendar quarters: only the day gaps between periods are checked, with small fixed tolerances.
// Any missing or ambiguous piece makes the result MISSING / AMBIGUOUS -- there is no fallback to another period.

import { dateStringFromEpochDay, epochDayOfDateString } from '../dates';
import { SEC_ITEMS } from './conceptMap';
import type { SecItemDef } from './conceptMap';
import { resolveItemAt } from './facts';
import type { FactIndex, Resolved } from './facts';

export type PeriodLength = 'Q' | 'H1' | 'M9' | 'FY';
export type YtdBucket = 'Q1' | 'H1' | 'M9' | 'FY';

export function dayOf(date: string): number {
  const day = epochDayOfDateString(date);
  if (day === null) throw new Error(`Invalid date "${date}".`);
  return day;
}

export function periodLength(days: number): PeriodLength | null {
  if (days >= 80 && days <= 100) return 'Q';
  if (days >= 170 && days <= 195) return 'H1';
  if (days >= 260 && days <= 285) return 'M9';
  if (days >= 350 && days <= 380) return 'FY';
  return null;
}

/** A fiscal year starts 1-3 days after the previous one ends (weekend / 52-53 week calendars). */
const FY_START_GAP_MIN = 1;
const FY_START_GAP_MAX = 3;
/** The comparable prior-year period ends within this many days of exactly one year earlier. */
const PRIOR_YEAR_TOLERANCE_DAYS = 10;
/** The balance sheet a year earlier is found within this many days of one year before. */
export const BALANCE_SHEET_YEAR_AGO_TOLERANCE_DAYS = 10;

export interface FiscalYear {
  readonly start: string;
  readonly end: string;
}

export interface Anchor {
  readonly start: string;
  readonly end: string;
  readonly bucket: YtdBucket;
  /** The fiscal year that ended just before this anchor's year began (null for the oldest year in the data). */
  readonly prevFiscalYear: FiscalYear | null;
}

function revenuePeriods(index: FactIndex): Array<{ start: string; end: string }> {
  const seen = new Set<string>();
  const out: Array<{ start: string; end: string }> = [];
  SEC_ITEMS.revenue.tags.forEach((tag) => {
    (index.get(`us-gaap:${tag}`) || []).forEach((fact) => {
      if (fact.start === null) return;
      const key = `${fact.start}|${fact.end}`;
      if (seen.has(key)) return;
      seen.add(key);
      out.push({ start: fact.start, end: fact.end });
    });
  });
  return out;
}

/** Fiscal years found in revenue facts (12-month durations), oldest first. */
export function findFiscalYears(index: FactIndex): FiscalYear[] {
  return revenuePeriods(index)
    .filter((p) => periodLength(dayOf(p.end) - dayOf(p.start)) === 'FY')
    .sort((a, b) => (a.end < b.end ? -1 : a.end > b.end ? 1 : 0));
}

/** Fiscal year immediately before a period that starts on `start`. */
function fiscalYearBefore(fiscalYears: readonly FiscalYear[], start: string): FiscalYear | null {
  const startDay = dayOf(start);
  const found = fiscalYears.filter((fy) => {
    const gap = startDay - dayOf(fy.end);
    return gap >= FY_START_GAP_MIN && gap <= FY_START_GAP_MAX;
  });
  return found.length === 1 ? found[0] : null;
}

/** Every fiscal-year-to-date period (3, 6, 9 months from a fiscal-year start, or the full year), oldest first. */
export function findAnchors(index: FactIndex, fiscalYears: readonly FiscalYear[]): Anchor[] {
  const anchors: Anchor[] = [];
  revenuePeriods(index).forEach((p) => {
    const length = periodLength(dayOf(p.end) - dayOf(p.start));
    if (length === null) return;
    const prev = fiscalYearBefore(fiscalYears, p.start);
    if (length === 'FY') {
      anchors.push({ start: p.start, end: p.end, bucket: 'FY', prevFiscalYear: prev });
      return;
    }
    // A cumulative period must begin where a fiscal year begins; standalone mid-year quarters are not anchors.
    const startsFiscalYear = prev !== null || fiscalYears.some((fy) => fy.start === p.start);
    if (!startsFiscalYear) return;
    anchors.push({ start: p.start, end: p.end, bucket: length === 'Q' ? 'Q1' : length, prevFiscalYear: prev });
  });
  return anchors.sort((a, b) => (a.end < b.end ? -1 : a.end > b.end ? 1 : a.bucket < b.bucket ? -1 : 1));
}

/** The same-length period one year earlier, or null when absent or when two are equally close. */
export function priorYearAnchor(anchors: readonly Anchor[], anchor: Anchor): Anchor | null {
  const endDay = dayOf(anchor.end);
  const ranked = anchors
    .filter((a) => a.bucket === anchor.bucket && a !== anchor)
    .map((a) => ({ a, miss: Math.abs(endDay - dayOf(a.end) - 365) }))
    .filter((r) => r.miss <= PRIOR_YEAR_TOLERANCE_DAYS && dayOf(r.a.end) < endDay)
    .sort((x, y) => x.miss - y.miss);
  if (ranked.length === 0) return null;
  if (ranked.length > 1 && ranked[0].miss === ranked[1].miss && ranked[0].a.end !== ranked[1].a.end) return null;
  return ranked[0].a;
}

export interface TtmPiece {
  readonly role: 'FY' | 'FY_PREVIOUS' | 'YTD_CURRENT' | 'YTD_PRIOR';
  readonly resolved: Resolved;
}

export type Ttm =
  | { readonly status: 'OK'; readonly value: number; readonly pieces: readonly TtmPiece[]; readonly filedMax: string; readonly restated: boolean }
  | { readonly status: 'MISSING'; readonly item: string; readonly reason: string }
  | { readonly status: 'AMBIGUOUS'; readonly item: string; readonly reason: string };

/** Trailing-twelve-month value of a DURATION item at `anchor`. */
export function ttmAt(index: FactIndex, def: SecItemDef, anchor: Anchor, anchors: readonly Anchor[]): Ttm {
  const pieceSpecs: Array<{ role: TtmPiece['role']; start: string; end: string; sign: 1 | -1 }> = [];
  if (anchor.bucket === 'FY') {
    pieceSpecs.push({ role: 'FY', start: anchor.start, end: anchor.end, sign: 1 });
  } else {
    const prior = priorYearAnchor(anchors, anchor);
    if (!anchor.prevFiscalYear) return { status: 'MISSING', item: def.id, reason: 'PRIOR_FISCAL_YEAR_NOT_FOUND' };
    if (!prior) return { status: 'MISSING', item: def.id, reason: 'PRIOR_YEAR_PERIOD_NOT_FOUND' };
    pieceSpecs.push({ role: 'FY_PREVIOUS', start: anchor.prevFiscalYear.start, end: anchor.prevFiscalYear.end, sign: 1 });
    pieceSpecs.push({ role: 'YTD_CURRENT', start: anchor.start, end: anchor.end, sign: 1 });
    pieceSpecs.push({ role: 'YTD_PRIOR', start: prior.start, end: prior.end, sign: -1 });
  }
  const pieces: TtmPiece[] = [];
  let value = 0;
  let filedMax = '';
  let restated = false;
  for (const spec of pieceSpecs) {
    const resolved = resolveItemAt(index, def, spec.start, spec.end);
    if (resolved.status === 'AMBIGUOUS') return { status: 'AMBIGUOUS', item: def.id, reason: `${resolved.reason}:${spec.role}` };
    if (resolved.status === 'MISSING') return { status: 'MISSING', item: def.id, reason: `ITEM_NOT_REPORTED:${spec.role}` };
    pieces.push({ role: spec.role, resolved });
    value += spec.sign * resolved.value;
    if (resolved.fact.filed > filedMax) filedMax = resolved.fact.filed;
    if (resolved.restated) restated = true;
  }
  return { status: 'OK', value, pieces, filedMax, restated };
}

/** Six consecutive fiscal years ending at the latest one (oldest first), or null when the history has gaps. */
export function consecutiveFiscalYears(fiscalYears: readonly FiscalYear[], count: number): FiscalYear[] | null {
  if (fiscalYears.length < count) return null;
  const window = fiscalYears.slice(fiscalYears.length - count);
  for (let i = 1; i < window.length; i += 1) {
    const gap = dayOf(window[i].end) - dayOf(window[i - 1].end);
    if (periodLength(gap) !== 'FY') return null;
  }
  return window;
}

/** `date` shifted by whole days (used for balance-sheet look-back). */
export function shiftDate(date: string, days: number): string {
  return dateStringFromEpochDay(dayOf(date) + days);
}
