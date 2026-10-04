// lib/discovery/qv/fcf.ts

// LEAPS-QV-0001 Gate 3 (Section 45.3, assumption A3) -- the free-cash-flow pattern, defined once.
//
// "One temporary negative period must not automatically invalidate an otherwise intact business", but persistent
// negative FCF and a slide into negative FCF are material. Quality (cash generation) and the fundamental-trajectory
// dimension both read the pattern from here, so the distinction is never implemented twice.

import type { Trajectory } from './reasons';
import { QV_V1_0_POLICY } from './policy';

export type FcfLevel = 'POSITIVE' | 'BREAKEVEN' | 'NEGATIVE';
export type FcfPattern = 'POSITIVE' | 'BREAKEVEN' | 'NEGATIVE_TEMPORARY' | 'NEGATIVE_PERSISTENT' | 'DETERIORATING_INTO_NEGATIVE' | 'NOT_EVALUABLE';

const FCF = QV_V1_0_POLICY.quality;

function recentPoints(history: readonly number[]): readonly number[] {
  return history.slice(history.length - FCF.fcfHistoryYears);
}

function strictlyFalling(points: readonly number[]): boolean {
  for (let i = 1; i < points.length; i += 1) if (!(points[i] < points[i - 1])) return false;
  return true;
}

function strictlyRising(points: readonly number[]): boolean {
  for (let i = 1; i < points.length; i += 1) if (!(points[i] > points[i - 1])) return false;
  return true;
}

/** Current FCF level from the TTM figure. Zero is BREAKEVEN, never negative. */
export function fcfLevelOf(ttm: number | null): FcfLevel | null {
  if (ttm === null) return null;
  return ttm > 0 ? 'POSITIVE' : ttm < 0 ? 'NEGATIVE' : 'BREAKEVEN';
}

function annualHistoryUsable(history: readonly number[] | null): history is readonly number[] {
  return history !== null && history.length >= FCF.fcfHistoryYears;
}

/**
 * Assumption A3 (ratified): current LEVEL and historical TRAJECTORY are separate.
 *  - Level comes from TTM (POSITIVE / BREAKEVEN / NEGATIVE).
 *  - History is ANNUAL, non-overlapping fiscal-year observations only (the last policy.quality.fcfHistoryYears). TTM overlaps the
 *    latest fiscal year, so it is never counted as another annual observation and never double-counts toward persistence.
 *  - PERSISTENT negative = NEGATIVE level and negative FCF in at least policy.quality.fcfPersistentNegativePoints annual periods.
 *  - A NEGATIVE level with strictly falling annual history (but fewer negative years) is DETERIORATING_INTO_NEGATIVE; otherwise
 *    NEGATIVE_TEMPORARY. A BREAKEVEN level is not a weakness and needs no history here.
 *  - A NEGATIVE level without usable annual history is NOT_EVALUABLE (fail closed), never assumed either way.
 */
export function classifyFcfPattern(ttm: number | null, history: readonly number[] | null): FcfPattern {
  const level = fcfLevelOf(ttm);
  if (level === null) return 'NOT_EVALUABLE';
  if (level === 'POSITIVE') return 'POSITIVE';
  if (level === 'BREAKEVEN') return 'BREAKEVEN';
  if (!annualHistoryUsable(history)) return 'NOT_EVALUABLE';
  const recent = recentPoints(history);
  let negative = 0;
  recent.forEach((point) => {
    if (point < 0) negative += 1;
  });
  if (negative >= FCF.fcfPersistentNegativePoints) return 'NEGATIVE_PERSISTENT';
  if (strictlyFalling(recent)) return 'DETERIORATING_INTO_NEGATIVE';
  return 'NEGATIVE_TEMPORARY';
}

/**
 * Current-vs-latest-FY guard (A3 clarification): a POSITIVE TTM figure below the latest annual FCF. TTM is compared as a LEVEL against
 * the latest fiscal year; it is not an annual observation and never counts toward persistence or the annual trajectory.
 */
export function fcfBelowLatestFiscalYear(ttm: number | null, history: readonly number[] | null): boolean {
  if (ttm === null || ttm <= 0 || !annualHistoryUsable(history)) return false;
  return ttm < history[history.length - 1];
}

/**
 * The cash-flow dimension of fundamental trajectory; null when it cannot be judged (never neutral). Historical trajectory is read
 * from the annual observations only. A POSITIVE or BREAKEVEN level needs the annual history to be judged.
 */
export function fcfTrajectory(ttm: number | null, history: readonly number[] | null): Trajectory | null {
  const pattern = classifyFcfPattern(ttm, history);
  if (pattern === 'NEGATIVE_PERSISTENT' || pattern === 'DETERIORATING_INTO_NEGATIVE') return 'DETERIORATING';
  if (pattern === 'NEGATIVE_TEMPORARY') return 'STABLE';
  if (pattern === 'POSITIVE' || pattern === 'BREAKEVEN') {
    if (!annualHistoryUsable(history)) return null;
    const recent = recentPoints(history);
    if (pattern === 'BREAKEVEN') return strictlyFalling(recent) ? 'DETERIORATING' : 'STABLE';
    // Rising annual history supports IMPROVING only while current TTM FCF has not fallen below the latest fiscal-year level.
    // No materiality threshold is authorized, so the TTM-vs-FY drop alone is never DETERIORATING: it is STABLE plus explicit context.
    if (fcfBelowLatestFiscalYear(ttm, history)) return 'STABLE';
    return strictlyRising(recent) ? 'IMPROVING' : 'STABLE';
  }
  return null;
}

export function fcfPatternIsMaterialWeakness(pattern: FcfPattern): boolean {
  return pattern === 'NEGATIVE_PERSISTENT' || pattern === 'DETERIORATING_INTO_NEGATIVE';
}
