// lib/scans/leapsScore.ts
//
// LEAPS-0004: composite 0-100 LEAPS ranking score, per Ian's explicit spec
// from the LEAPS-0002/0003 design conversation:
//   "Cost Efficiency -- 60 points. This is the one number that matters
//   most... extrinsic value as a % of total cost. A LEAPS with low
//   extrinsic relative to what you paid is mostly real stock exposure...
//   Liquidity -- 40 points. Same shape as PMCC's -- spread% and OI...
//   You're not trading in and out of this fast, but you're going to want
//   a fair fill going in and, eventually, coming out."
//
// Deliberately does NOT reuse computePmccScore() directly -- LEAPS has no
// ROI to score (it isn't collecting premium) and no second leg to compare
// against, so PMCC's own function doesn't fit. What IS reused is the
// specific SHAPE of PMCC's liquidity fraction (50% spread-penalty against
// a ceiling, 50% OI against a floor) -- Ian's own words, "same shape",
// not a coincidence.
//
// Delta and DTE are deliberately NOT score inputs, same reasoning as
// PMCC's exclusion of Trend: the delta-range and DTE-floor FILTERS already
// do that job. Scoring them again would double-count the same signal a
// candidate already had to clear to appear in the results at all.

export interface LeapsScoreInputs {
  extrinsicValue: number | null;
  totalCost: number | null;
  spreadPct: number | null;
  openInterest: number | null;
}

export interface LeapsScoreBreakdown {
  total: number;
  costEfficiencyScore: number;
  liquidityScore: number;
  /** True when the score could not be fully computed (a required input
   *  was null) -- the returned total is still the best available partial
   *  score (each missing component scores 0, not fabricated), but this
   *  flag lets the UI show that honestly rather than presenting a partial
   *  score as if it were complete. */
  incomplete: boolean;
}

const COST_EFFICIENCY_MAX_POINTS = 60;
const LIQUIDITY_MAX_POINTS = 40;

// FIRST-DRAFT CEILING, NOT YET IAN-REVIEWED. Real extrinsic% values seen
// in this app's own screenshots so far cluster around 11-19% for
// perfectly reasonable, already-filtered (0.70-0.85 delta) candidates --
// this ceiling assumes something meaningfully worse than that (30%) earns
// zero Cost Efficiency points, but that assumption hasn't been checked
// against real candidate spread across many tickers the way the
// extrinsic% FILTER's own threshold deliberately was left unset pending
// exactly that review. Treat this number the same way: real, functional,
// but provisional until Ian looks at real score outputs and either
// confirms or adjusts it.
const COST_EFFICIENCY_CEILING_PCT = 30;

// Reused from pmccScore.ts's legLiquidityFraction, same two ceilings
// (10% spread, 500 OI) -- Ian's own instruction was "same shape as
// PMCC's", and these are PMCC's actual, already-reviewed numbers, not
// independently re-derived here.
const SPREAD_PENALTY_CEILING_PCT = 10;
const OI_FULL_MARKS_FLOOR = 500;

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export function computeLeapsScore(inputs: LeapsScoreInputs): LeapsScoreBreakdown {
  const extrinsicPctOfCost = inputs.extrinsicValue != null && inputs.totalCost != null && inputs.totalCost > 0
    ? (inputs.extrinsicValue * 100 / inputs.totalCost) * 100
    : null;
  const costEfficiencyFraction = extrinsicPctOfCost != null
    ? clamp01(1 - extrinsicPctOfCost / COST_EFFICIENCY_CEILING_PCT)
    : 0;
  const costEfficiencyScore = Math.round(costEfficiencyFraction * COST_EFFICIENCY_MAX_POINTS);

  const spreadPenalty = inputs.spreadPct != null ? clamp01(1 - inputs.spreadPct / SPREAD_PENALTY_CEILING_PCT) : 0;
  const oiPenalty = inputs.openInterest != null ? clamp01(inputs.openInterest / OI_FULL_MARKS_FLOOR) : 0;
  const liquidityFraction = 0.5 * spreadPenalty + 0.5 * oiPenalty;
  const liquidityScore = Math.round(liquidityFraction * LIQUIDITY_MAX_POINTS);

  const incomplete = extrinsicPctOfCost == null || inputs.spreadPct == null || inputs.openInterest == null;

  return { total: costEfficiencyScore + liquidityScore, costEfficiencyScore, liquidityScore, incomplete };
}
