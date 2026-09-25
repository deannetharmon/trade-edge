// lib/scans/qualificationState.ts
//
// QUAL-STATES-0001: the three qualification states every scan uses, derived only from the
// per-check statuses of the row being shown.
//   disqualified: at least one gate check failed (or is missing/unknown: fail closed)
//   caution:      no failures, at least one warning
//   qualified:    every gate check passed
// Which checks are gates differs by scan; each scan passes its own gate keys.

import type { CheckResult, ScreenResult } from './types';

export type QualificationState = 'qualified' | 'caution' | 'disqualified';

export interface QualificationDerivation {
  state: QualificationState;
  failing: string[];
  warning: string[];
}

/** Ranked spread scan: credit, delta and POP have no floor in Ranked (scored, not gated). */
export const RANKED_SPREAD_GATE_KEYS = ['ivr', 'earnings', 'oi', 'roc'] as const;

export function deriveQualificationState(
  checks: Partial<Record<string, CheckResult | undefined>>,
  gateKeys: readonly string[],
): QualificationDerivation {
  const failing: string[] = [];
  const warning: string[] = [];
  for (const key of gateKeys) {
    const status = checks[key]?.status;
    if (status === 'pass') continue;
    if (status === 'warn') warning.push(key);
    else failing.push(key);
  }
  const state: QualificationState = failing.length > 0 ? 'disqualified' : warning.length > 0 ? 'caution' : 'qualified';
  return { state, failing, warning };
}

const SPREAD_STRATEGIES = new Set(['BPS', 'BCS', 'IC']);

/** Three-state derivation for a Ranked or Targeted spread result; null for anything else (those scans keep their own model). */
export function deriveSpreadQualification(result: ScreenResult): QualificationDerivation | null {
  const strategy = result.bestCandidate?.strategy ?? result.strategy;
  if (!SPREAD_STRATEGIES.has(strategy) || !result.checks) return null;
  return deriveQualificationState(result.checks, RANKED_SPREAD_GATE_KEYS);
}

export interface QualificationStateCounts {
  qualified: number;
  caution: number;
  disqualified: number;
}

/** Counts by state, always derived from each row's checks so saved and fresh scans agree. Non-spread rows fall back to their qualified flag. */
export function countQualificationStates(results: readonly ScreenResult[]): QualificationStateCounts {
  const counts: QualificationStateCounts = { qualified: 0, caution: 0, disqualified: 0 };
  for (const result of results) {
    const state = deriveSpreadQualification(result)?.state ?? (result.qualified ? 'qualified' : 'disqualified');
    counts[state] += 1;
  }
  return counts;
}
