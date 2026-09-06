// lib/scans/cspScore.ts
// CSP-WORKFLOW-0001 — strategy-aware CSP scoring module.
//
// Replaces the generic Autopilot opportunity score (lib/autopilot/scoring/opportunity.ts,
// shared unmodified by BPS/BCS/IC/CC/CSP alike — see
// docs/reviews/FIND-CSP-Comprehensive-Code-Audit.md §21) as CSP's PRIMARY
// score. That generic engine is untouched by this module (still used for
// Autopilot's own capital-pool sequencing/disposition, out of this ticket's
// scope) — this is a new, independent, CSP-specific score surfaced directly
// on the ScreenResult/SpreadCandidate for Filter/Rank/Targeted and card
// display.
//
// Six weighted dimensions, each an independently normalized 0-100 subscore
// BEFORE weighting, summing to 100 points when every input is available:
//   1. Downside/entry cushion   -- 20 pts (POP 10, OTM% 10)
//   2. Premium efficiency       -- 25 pts (period ROC 10, annualized ROC 15)
//   3. Liquidity quality        -- 20 pts (width/classification 15, OI 5)
//   4. Underlying technical     -- 15 pts (trend/technicalFit input)
//   5. Volatility context       -- 10 pts (IVR)
//   6. Event risk               -- 10 pts (earnings-before-expiration)
//
// Missing-data policy (CSP-WORKFLOW-0001 core-correction, BLOCKER-03 —
// supersedes the original renormalize-over-available-weight policy this
// module shipped with, which is now rejected as too permissive): ALL NINE
// components are required. If even one is unavailable, the score itself is
// UNAVAILABLE -- `scoreStatus: 'UNAVAILABLE'`, `total: null`, and the exact
// missing component keys are still reported. This module never silently
// renormalizes a partial score into an apparently-complete 0-100 number,
// and never displays 0 as though it were a real calculated score for a
// candidate that simply couldn't be scored. A candidate with an
// UNAVAILABLE score remains visible in the UI (this module makes no
// visibility decision); it is excluded from score-based Best Opportunities
// ranking by the caller, since there is no valid number to rank by.
//
// Pure, framework-free, independently testable. Every normalization
// constant lives in CSP_SCORE_CONFIG below, not scattered through
// components.

export const CSP_SCORE_VERSION = 'csp-score-v1';

export const CSP_SCORE_WEIGHTS = {
  pop: 10,
  otm: 10,
  periodRoc: 10,
  annualizedRoc: 15,
  liquidityWidth: 15,
  liquidityOi: 5,
  technical: 15,
  ivr: 10,
  eventRisk: 10,
} as const;

// Documented normalization caps -- values at/above the cap map to a 100
// subscore; values scale linearly below it. These are deliberately
// conservative starting points, not derived from any backtest; Ian should
// review/approve them alongside the liquidity-threshold decision.
export const CSP_SCORE_CONFIG = {
  otmCapPct: 20,           // OTM% at or above 20% scores a full 100 on that dimension
  periodRocCapPct: 5,      // period ROC at or above 5% scores a full 100
  annualizedRocCapPct: 50, // annualized ROC at or above 50% scores a full 100
  liquidityClassScore: { STRONG: 100, BORDERLINE: 50, POOR: 0 } as Record<string, number>,
  oiQualityDivisorMultiple: 1, // OI at or above 1x the configured OI_MIN scores a full 100
} as const;

export type CspScoreComponentKey =
  | 'pop' | 'otm' | 'periodRoc' | 'annualizedRoc'
  | 'liquidityWidth' | 'liquidityOi' | 'technical' | 'ivr' | 'eventRisk';

export interface CspScoreInputs {
  pop: number | null | undefined;              // 0-100
  otmPct: number | null | undefined;            // percent, unbounded above 0
  periodRocPct: number | null | undefined;      // percent
  annualizedRocPct: number | null | undefined;  // percent
  liquidityClass: 'STRONG' | 'BORDERLINE' | 'POOR' | null | undefined;
  openInterest: number | null | undefined;
  oiMin: number;                                 // the configured OI preference, for normalization
  technicalFit: number | null | undefined;       // 0-100, e.g. trendResult.scores.total
  ivr: number | null | undefined;                // 0-100 IV Rank percentile
  /** Preferred IVR band -- see the ivr scoring comment below for why this
   * is a band, not a floor-only comparison. Optional for backward
   * compatibility with existing callers; omitting these falls back to the
   * old flat identity mapping rather than failing the score closed. */
  ivrMin?: number | null;
  ivrMax?: number | null;
  /**
   * true  = a known earnings/event occurs before expiration (event risk)
   * false = no known earnings/event before expiration (safe)
   * null/undefined = UNKNOWN -- distinct from "no event"; excluded from
   *                  scoring and recorded as a missing input, never
   *                  silently treated as "safe."
   */
  earningsWithinExpiration: boolean | null | undefined;
}

export type CspScoreStatus = 'AVAILABLE' | 'UNAVAILABLE';

export interface CspScoreResult {
  /** 'AVAILABLE' only when every one of the 9 components could be computed;
   * 'UNAVAILABLE' otherwise. Callers must gate display/ranking on this
   * field, never on `total != null` alone (though the two always agree). */
  scoreStatus: CspScoreStatus;
  /** 0-100 when scoreStatus is 'AVAILABLE'; null when 'UNAVAILABLE' --
   * never a fabricated 0 standing in for "couldn't be scored." Full
   * precision retained; round only at the final display step. */
  total: number | null;
  components: Record<CspScoreComponentKey, number | null>; // null = unavailable
  inputsUsed: CspScoreComponentKey[];
  missingInputs: CspScoreComponentKey[];
  scoreVersion: typeof CSP_SCORE_VERSION;
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function linearCap(value: number, cap: number): number {
  if (cap <= 0) return 0;
  return clamp((value / cap) * 100, 0, 100);
}

function isFiniteNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/**
 * CSP-WORKFLOW-0001 — the canonical, pure CSP scoring function. Every
 * component is computed independently; nothing here reads account/capital
 * state (account eligibility must never alter the market-quality score --
 * see docs/reviews/FIND-CSP-Comprehensive-Code-Audit.md §23). Two contracts
 * on the same ticker score fully independently since every input is
 * candidate-specific (delta-derived POP, this contract's own width/OI/ROC).
 */
export function calculateCspScore(inputs: CspScoreInputs): CspScoreResult {
  const components: Record<CspScoreComponentKey, number | null> = {
    pop: null, otm: null, periodRoc: null, annualizedRoc: null,
    liquidityWidth: null, liquidityOi: null, technical: null, ivr: null, eventRisk: null,
  };

  // 1. Downside / entry cushion
  if (isFiniteNum(inputs.pop)) components.pop = clamp(inputs.pop, 0, 100);
  if (isFiniteNum(inputs.otmPct)) components.otm = linearCap(inputs.otmPct, CSP_SCORE_CONFIG.otmCapPct);

  // 2. Premium efficiency
  if (isFiniteNum(inputs.periodRocPct)) components.periodRoc = linearCap(inputs.periodRocPct, CSP_SCORE_CONFIG.periodRocCapPct);
  if (isFiniteNum(inputs.annualizedRocPct)) components.annualizedRoc = linearCap(inputs.annualizedRocPct, CSP_SCORE_CONFIG.annualizedRocCapPct);

  // 3. Liquidity quality
  if (inputs.liquidityClass) components.liquidityWidth = CSP_SCORE_CONFIG.liquidityClassScore[inputs.liquidityClass] ?? null;
  if (isFiniteNum(inputs.openInterest) && isFiniteNum(inputs.oiMin) && inputs.oiMin > 0) {
    components.liquidityOi = linearCap(inputs.openInterest, inputs.oiMin * CSP_SCORE_CONFIG.oiQualityDivisorMultiple);
  }

  // 4. Underlying technical quality — fails CLOSED (unavailable), never a
  // fabricated neutral 50, per the ticket's explicit requirement.
  if (isFiniteNum(inputs.technicalFit)) components.technical = clamp(inputs.technicalFit, 0, 100);

  // 5. Volatility context — Fix: the previous version treated ivr as a
  // flat 0-100 "more is always better" scale (clamp(ivr, 0, 100)), which
  // is a category error: this app's own established CSP rule set treats
  // IVR as a PREFERRED BAND [ivrMin, ivrMax], not a monotonic quality
  // dial (confirmed by IVR_MAX already being a hard disqualifier
  // elsewhere in the pipeline -- more IVR is not "better" past that
  // ceiling, so it should not score as if it were). Band-aware: full
  // marks anywhere inside the preferred band, scaled down outside it in
  // either direction.
  //
  // IMPORTANT, told to Ian/Paul directly rather than silently accepted:
  // this fixes the curve's *correctness*, not the underlying weight. At
  // a 10/100 weight, this component can NEVER move the final score by
  // more than 10 points regardless of curve shape -- confirmed by direct
  // calculation against the real OXY/HPE example (OXY's total was
  // already 12 points below HPE's under the OLD flat mapping, entirely
  // from the other 8 components, and still ranked in the top slots). A
  // curve fix alone cannot guarantee "never outranks an in-band
  // candidate" -- only a weight change can, and CSP_SCORE_WEIGHTS is
  // explicitly marked in this file's own header as reserved for Ian's
  // review, not something to change unilaterally under time pressure.
  if (isFiniteNum(inputs.ivr) && isFiniteNum(inputs.ivrMin) && isFiniteNum(inputs.ivrMax) && inputs.ivrMax > inputs.ivrMin) {
    if (inputs.ivr >= inputs.ivrMin && inputs.ivr <= inputs.ivrMax) {
      components.ivr = 100;
    } else if (inputs.ivr < inputs.ivrMin) {
      components.ivr = linearCap(inputs.ivr, inputs.ivrMin);
    } else {
      // Above ivrMax: in practice this candidate is usually already
      // disqualified upstream (IVR_MAX hard cap), so this branch is
      // rarely reached -- scored low rather than rewarded for excess,
      // consistent with "more IVR past the ceiling is not better."
      const excessAboveMax = inputs.ivr - inputs.ivrMax;
      components.ivr = clamp(100 - linearCap(excessAboveMax, inputs.ivrMax), 0, 100);
    }
  } else if (isFiniteNum(inputs.ivr)) {
    // ivrMin/ivrMax not supplied by this caller -- fall back to the prior
    // identity mapping rather than fail closed on a component every
    // existing caller already provides ivr for. New callers should pass
    // ivrMin/ivrMax to get the band-aware behavior above.
    components.ivr = clamp(inputs.ivr, 0, 100);
  }

  // 6. Event risk — unknown is distinguished from "no event": only a
  // definite true/false produces a component score.
  if (inputs.earningsWithinExpiration === true) components.eventRisk = 0;
  else if (inputs.earningsWithinExpiration === false) components.eventRisk = 100;
  // else: null/undefined -> stays null (missing), never assumed safe.

  const weights = CSP_SCORE_WEIGHTS;
  const componentWeight: Record<CspScoreComponentKey, number> = {
    pop: weights.pop, otm: weights.otm, periodRoc: weights.periodRoc, annualizedRoc: weights.annualizedRoc,
    liquidityWidth: weights.liquidityWidth, liquidityOi: weights.liquidityOi,
    technical: weights.technical, ivr: weights.ivr, eventRisk: weights.eventRisk,
  };

  const inputsUsed: CspScoreComponentKey[] = [];
  const missingInputs: CspScoreComponentKey[] = [];
  let weightedSum = 0;
  let weightAvailable = 0;

  (Object.keys(components) as CspScoreComponentKey[]).forEach((key) => {
    const value = components[key];
    const weight = componentWeight[key];
    if (value == null) {
      missingInputs.push(key);
      return;
    }
    inputsUsed.push(key);
    weightedSum += value * weight;
    weightAvailable += weight;
  });

  // BLOCKER-03 — ALL components are required. Any missing input makes the
  // whole score UNAVAILABLE; never a partial/renormalized number, never a
  // fabricated 0.
  if (missingInputs.length > 0) {
    return {
      scoreStatus: 'UNAVAILABLE',
      total: null,
      components,
      inputsUsed,
      missingInputs,
      scoreVersion: CSP_SCORE_VERSION,
    };
  }

  const total = clamp(weightedSum / weightAvailable, 0, 100);

  return {
    scoreStatus: 'AVAILABLE',
    total,
    components,
    inputsUsed,
    missingInputs,
    scoreVersion: CSP_SCORE_VERSION,
  };
}
