// lib/scans/qualificationState.ts
//
// QUAL-STATES-0001: the three qualification states every scan uses, derived only from the
// per-check statuses of the row being shown.
//   disqualified: at least one gate check failed (or is missing/unknown: fail closed)
//   caution:      no failures, at least one warning
//   qualified:    every gate check passed
// Which checks are gates differs by scan; each scan passes its own gate keys.

import type { CheckResult } from './types';

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
