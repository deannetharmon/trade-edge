// lib/discovery/qv/fcf.ts

// LEAPS-QV-0001 Gate 3 (Section 45.3, assumption A3) -- the free-cash-flow pattern, defined once.
//
// "One temporary negative period must not automatically invalidate an otherwise intact business", but persistent
// negative FCF and a slide into negative FCF are material. Quality (cash generation) and the fundamental-trajectory
// dimension both read the pattern from here, so the distinction is never implemented twice.

import type { Trajectory } from './reasons';
import { QV_V1_0_POLICY } from './policy';

export type FcfPattern = 'POSITIVE' | 'NEGATIVE_TEMPORARY' | 'NEGATIVE_PERSISTENT' | 'DETERIORATING_INTO_NEGATIVE' | 'NOT_EVALUABLE';

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

/**
 * `ttm` is the trailing-twelve-month FCF (null when not VALID); `history` the annual FCF points, oldest first (null when
 * there is no usable history). Positive TTM FCF is the expected case and needs no history. A non-positive TTM figure
 * cannot be called temporary or persistent without history, so it is NOT_EVALUABLE -- never assumed either way.
 */
export function classifyFcfPattern(ttm: number | null, history: readonly number[] | null): FcfPattern {
  if (ttm === null) return 'NOT_EVALUABLE';
  if (ttm > 0) return 'POSITIVE';
  if (history === null || history.length < FCF.fcfHistoryYears) return 'NOT_EVALUABLE';
  const recent = recentPoints(history);
  let negative = 0;
  recent.forEach((point) => {
    if (point <= 0) negative += 1;
  });
  if (recent[recent.length - 1] <= 0 || negative >= FCF.fcfPersistentNegativePoints) return 'NEGATIVE_PERSISTENT';
  if (strictlyFalling(recent)) return 'DETERIORATING_INTO_NEGATIVE';
  return 'NEGATIVE_TEMPORARY';
}

/** The cash-flow dimension of fundamental trajectory; null when it cannot be judged (never neutral). */
export function fcfTrajectory(ttm: number | null, history: readonly number[] | null): Trajectory | null {
  const pattern = classifyFcfPattern(ttm, history);
  if (pattern === 'NEGATIVE_PERSISTENT' || pattern === 'DETERIORATING_INTO_NEGATIVE') return 'DETERIORATING';
  if (pattern === 'NEGATIVE_TEMPORARY') return 'STABLE';
  if (pattern === 'POSITIVE') {
    if (history === null || history.length < FCF.fcfHistoryYears) return null;
    return strictlyRising(recentPoints(history)) ? 'IMPROVING' : 'STABLE';
  }
  return null;
}

export function fcfPatternIsMaterialWeakness(pattern: FcfPattern): boolean {
  return pattern === 'NEGATIVE_PERSISTENT' || pattern === 'DETERIORATING_INTO_NEGATIVE';
}
