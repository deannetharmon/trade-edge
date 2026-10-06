// lib/discovery/leaps/policy.ts

// LEAPS-QV-0001 Gate 4b -- the QV LEAPS contract POLICY: eligibility gates, quote rules and ranking, in one place.
// Every value is a ruled decision of spec revision 4 (Section 16) and nowhere else: the evaluator imports this object.
// Changing any value is an investment-logic change and therefore a new policy version; a test pins the fingerprint.
//
//   gates    -- Section 7: DTE 365-900 (I1), delta 0.70-0.85 (Ian 2026-10-06), OI >= 100, spread <= 10% of mid,
//               extrinsic <= 20% of mid (I2). Inclusive comparisons after quantizing both sides to 1e-9.
//   quotes   -- Section 4.3 as ruled by I6, I7, I12, Q7: LIVE during the session (age <= 15 min, option/underlying
//               skew <= 60 s); LAST_SESSION outside it (quote stamped at or after the latest completed close minus 60
//               minutes, two-sided market required); future timestamps tolerated up to 5 s. No DELAYED mode (no flag).
//   ranking  -- Section 8 as ruled by I5: time-value cost 70 (breakeven move, zero at 15% of spot) + liquidity 30
//               (spread zero at 10% of mid, open interest full at 500); quantized lexicographic comparator (Q5).
//   instrument -- I8: a standard deliverable is 100 shares of the underlying under its own root.

import { deepFreeze } from '../util';
import { QV_LEAPS_ACQUISITION_VERSION } from './acquisitionPolicy';

export const QV_LEAPS_POLICY_VERSION = 'QV-LEAPS-v1';

export const QV_LEAPS_POLICY_V1 = deepFreeze({
  version: QV_LEAPS_POLICY_VERSION,
  acquisitionVersion: QV_LEAPS_ACQUISITION_VERSION,
  gates: {
    dteMin: 365,
    dteMax: 900,
    deltaMin: 0.7,
    deltaMax: 0.85,
    openInterestMin: 100,
    spreadPctMax: 10,
    extrinsicPctMax: 20,
  },
  quotes: {
    liveMaxAgeMs: 15 * 60 * 1000,
    skewMaxMs: 60 * 1000,
    futureToleranceMs: 5 * 1000,
    lastSessionWindowMs: 60 * 60 * 1000,
  },
  instrument: {
    sharesPerContract: 100,
  },
  ranking: {
    timeValueWeight: 70,
    timeValueZeroAtBreakevenMovePct: 15,
    liquidityWeight: 30,
    spreadZeroAtPct: 10,
    openInterestFullAt: 500,
    scoreQuantum: 1e6,
    ratioQuantum: 1e6,
  },
  gateQuantum: 1e9,
});

export type QvLeapsPolicy = typeof QV_LEAPS_POLICY_V1;

/** Policy invariants (spec Section 7): the K >= S exclusion is only eligibility-preserving while extrinsicPctMax < 100. */
export function leapsPolicyInvariantViolations(policy: QvLeapsPolicy): string[] {
  const out: string[] = [];
  const g = policy.gates;
  const all = [g.dteMin, g.dteMax, g.deltaMin, g.deltaMax, g.openInterestMin, g.spreadPctMax, g.extrinsicPctMax];
  if (!all.every((v) => Number.isFinite(v))) out.push('NON_FINITE_THRESHOLD');
  if (!(g.extrinsicPctMax < 100)) out.push('EXTRINSIC_MAX_NOT_BELOW_100');
  if (!(g.deltaMin <= g.deltaMax)) out.push('DELTA_RANGE_INVERTED');
  if (!(g.dteMin <= g.dteMax)) out.push('DTE_RANGE_INVERTED');
  return out;
}
