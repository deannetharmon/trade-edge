// lib/scans/qualificationState.ts
//
// QUAL-STATES-0001: the three qualification states every scan uses, derived only from the
// per-check statuses of the row being shown.
//   disqualified: at least one gate check failed (or is missing/unknown: fail closed)
//   caution:      no failures, at least one warning
//   qualified:    every gate check passed
// Which checks are gates differs by scan; each scan passes its own gate keys.

import type { CheckResult, ScreenResult } from './types';
import { EARNINGS_MIN_DAYS_AFTER_EXPIRY } from './earningsPrecheck';

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

export interface DerivedQualification {
  derivation: QualificationDerivation;
  checks: Record<string, CheckResult>;
}

const CSP_GATE_KEYS = ['csp-market', 'csp-mode', 'csp-delta'] as const;

const CSP_MARKET_LABELS: Record<string, string> = {
  DISQUALIFIED_IVR: 'IVR above the CSP risk cap',
  DISQUALIFIED_IVR_UNAVAILABLE: 'IV rank unavailable, so the IVR cap cannot be verified',
  DISQUALIFIED_EARNINGS: `earnings on or within ${EARNINGS_MIN_DAYS_AFTER_EXPIRY} days after expiry`,
  DISQUALIFIED_POOR_LIQUIDITY: 'poor liquidity',
  DISQUALIFIED_INVALID_QUOTE: 'no valid quote',
  DISQUALIFIED_FOUNDATION_INELIGIBLE: 'market-state evidence contradicts a cash-secured put thesis',
  DISQUALIFIED_FOUNDATION_INSUFFICIENT_EVIDENCE: 'not enough market-state evidence for a cash-secured put thesis',
};

const cspPass = (label: string): CheckResult => ({ status: 'pass', value: label, reason: label });

/**
 * Three-state derivation for a CSP result, from the candidate's own qualification states.
 * Disqualified: any DISQUALIFIED_* market state, or a failed targeted minimum. Caution: qualified with a
 * liquidity warning, or market-qualified but outside the preferred delta range (not a Best Opportunity).
 * Account capital is a separate axis (shown on the card, enforced by the order guard) and not part of this.
 * Null for anything that is not a CSP with a market qualification.
 */
export function deriveCspQualification(result: ScreenResult): DerivedQualification | null {
  const c = result.bestCandidate;
  if (!c || c.strategy !== 'CSP' || !c.cspMarketQualification) return null;
  const market = c.cspMarketQualification;
  const marketQualified = market === 'QUALIFIED' || market === 'QUALIFIED_WITH_LIQUIDITY_WARNING';
  const checks: Record<string, CheckResult> = {
    'csp-market': market === 'QUALIFIED'
      ? cspPass('market qualified')
      : market === 'QUALIFIED_WITH_LIQUIDITY_WARNING'
        ? { status: 'warn', value: c.cspLiquidityReason ?? 'borderline liquidity', reason: c.cspLiquidityReason ?? 'Liquidity is borderline: kept, but excluded from Best Opportunities.' }
        : { status: 'fail', value: CSP_MARKET_LABELS[market] ?? 'not market qualified', reason: CSP_MARKET_LABELS[market] ?? market },
    'csp-mode': c.cspModeQualification === 'FAILED'
      ? { status: 'fail', value: 'below your targeted minimums', reason: (c.cspModeQualificationReasons ?? []).join('; ') || 'Below the targeted scan minimums.' }
      : cspPass('targeted minimums met'),
    'csp-delta': marketQualified && c.cspDeltaTargetPassing === false
      ? { status: 'warn', value: 'delta outside the preferred range', reason: 'Only deltas in the preferred range are listed as Best Opportunities.' }
      : cspPass('delta in the preferred range'),
  };
  return { derivation: deriveQualificationState(checks, CSP_GATE_KEYS), checks };
}
