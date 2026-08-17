// lib/scans/pmccScore.ts
//
// PMCC-RANK-0001: composite ranking score, per Ian/Paul's explicit
// sign-off (session recap: ROI 0-60 against a fixed 60% annualized
// benchmark -- not a per-scan relative percentile, since Ian wanted a
// score that means the same thing session to session, not one that
// silently redefines itself based on what else showed up in that day's
// scan; Liquidity 0-30 on the WORSE of the two legs' spread%/OI, never
// the average, so a bad short-leg spread can't hide behind a great
// long-leg spread; Earnings 0/-10 binary deduction, opt-in-disableable,
// deliberately not a scaled curve since there's no principled way to
// say "8 days out is worse than 20" without more thought).
//
// Trend is deliberately NOT an input here -- per the same sign-off,
// trend stays a gate/warning on the card, never a score input, so a
// bullish/bearish read can't quietly inflate or deflate a ranking
// number the operator is using to compare structures.
//
// Pure, no fetch, no React -- same extraction discipline as
// positionMetrics.ts and pmccLegEconomics.ts, so this is directly
// unit-testable and reusable by both the ranked screener view and any
// future consumer (e.g. Best Opportunities, if PMCC is ever added
// there -- a separate, still-undecided product question per standing
// project notes, not assumed here).

export interface PmccScoreInputs {
  annualizedRoiPct: number | null;
  longLegSpreadPct: number | null;
  longLegOpenInterest: number | null;
  shortLegSpreadPct: number | null;
  shortLegOpenInterest: number | null;
  earningsDate: string | null;
  shortLegExpiration: string;
  /** Operator opt-out for the earnings deduction, per the standing
   *  requirement that it stay disableable, not a silent penalty. */
  earningsDeductionEnabled: boolean;
}

export interface PmccScoreBreakdown {
  total: number;
  roiScore: number;
  liquidityScore: number;
  earningsDeduction: number;
  earningsFlagged: boolean;
}

const ROI_FULL_MARKS_BENCHMARK_PCT = 60;
const ROI_MAX_POINTS = 60;
const LIQUIDITY_MAX_POINTS = 30;
const EARNINGS_DEDUCTION_POINTS = 10;
// 10% matches the existing PMCC qualification ceiling (PmccQuotePolicy's
// qualifyingSpreadPctMax convention) -- a spread at the ceiling earns
// zero of the spread-half of the liquidity score, not a negative or
// undefined value.
const SPREAD_PENALTY_CEILING_PCT = 10;
// 500 OI treated as "plenty" -- full marks past this point, no bonus for
// exceeding it. Matches the order-of-magnitude PMCC qualification already
// treats as healthy liquidity elsewhere in this codebase's OI minimums.
const OI_FULL_MARKS_FLOOR = 500;

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function legLiquidityFraction(spreadPct: number | null, openInterest: number | null): number {
  const spreadPenalty = spreadPct != null ? clamp01(1 - spreadPct / SPREAD_PENALTY_CEILING_PCT) : 0;
  const oiPenalty = openInterest != null ? clamp01(openInterest / OI_FULL_MARKS_FLOOR) : 0;
  return 0.5 * spreadPenalty + 0.5 * oiPenalty;
}

/** True when the earnings date falls before the short leg's own
 *  expiration -- the leg actually at risk of an earnings-driven move,
 *  not the position as a whole (matches how the short-leg-scoped GTC/
 *  stop logic in pmccStopGtcPrompt.ts already treats this leg-specific
 *  boundary). */
function earningsFallsBeforeShortExpiration(earningsDate: string | null, shortExpiration: string): boolean {
  if (!earningsDate) return false;
  const earnings = new Date(`${earningsDate}T00:00:00`);
  const expiry = new Date(`${shortExpiration}T23:59:59`);
  if (Number.isNaN(earnings.getTime()) || Number.isNaN(expiry.getTime())) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return earnings >= today && earnings <= expiry;
}

/**
 * Composite 0-100 PMCC ranking score. Returns a full breakdown, not just
 * a total, so the card can decompose the number into its inputs -- per
 * Paul's explicit requirement that the score never be a mystery number.
 */
export function computePmccScore(inputs: PmccScoreInputs): PmccScoreBreakdown {
  const roiFraction = inputs.annualizedRoiPct != null
    ? clamp01(inputs.annualizedRoiPct / ROI_FULL_MARKS_BENCHMARK_PCT)
    : 0;
  const roiScore = Math.round(roiFraction * ROI_MAX_POINTS);

  const longLiquidity = legLiquidityFraction(inputs.longLegSpreadPct, inputs.longLegOpenInterest);
  const shortLiquidity = legLiquidityFraction(inputs.shortLegSpreadPct, inputs.shortLegOpenInterest);
  const liquidityScore = Math.round(Math.min(longLiquidity, shortLiquidity) * LIQUIDITY_MAX_POINTS);

  const earningsFlagged = earningsFallsBeforeShortExpiration(inputs.earningsDate, inputs.shortLegExpiration);
  const earningsDeduction = inputs.earningsDeductionEnabled && earningsFlagged ? -EARNINGS_DEDUCTION_POINTS : 0;

  const total = Math.max(0, roiScore + liquidityScore + earningsDeduction);

  return { total, roiScore, liquidityScore, earningsDeduction, earningsFlagged };
}

