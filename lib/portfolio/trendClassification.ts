// lib/portfolio/trendClassification.ts
//
// PI-0006B-FOLLOWUP: trend classification, extracted so both the
// per-card trend fetch (app/portfolio/page.tsx's getTrend) and the
// batch trend fetch feeding the recommendation engine
// (lib/portfolio/trendFetch.ts) compute trend from the identical logic.
// Per Ian's explicit sign-off requirement, these two call sites must
// never drift into two slightly different trend reads for the same
// symbol -- this module is the one place that math lives. Pure, no
// fetch -- takes closing prices, returns the classification.
//
// classifyTrendFromCloses is a verbatim extraction of the scoring logic
// that previously lived only inside app/portfolio/page.tsx's getTrend --
// same thresholds, same score weights, same trend/strategy/confidence
// output shape. getTrend now calls this function instead of keeping its
// own inline copy (see that call site's own comment).

export type TrendDirection = 'uptrend' | 'downtrend' | 'sideways' | 'unknown';
export type TrendStrategyHint = 'BPS' | 'BCS' | 'IC' | 'NO_TRADE';

export interface TrendClassification {
  trend: TrendDirection;
  strategy: TrendStrategyHint;
  confidence: number;
  reason: string;
}

function avgNumbers(arr: number[]): number {
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

/**
 * Pure trend classification from a series of closing prices (oldest
 * first, most recent last). Requires at least 90 closes -- returns
 * 'unknown'/'NO_TRADE' at confidence 0 otherwise.
 *
 * PMCC-RANK-TREND-WINDOW-0001 -- Ian's explicit decision: 60/90-day
 * moving averages, not the prior MA20/MA50. Now that this function
 * feeds technicalAlignment into real portfolio recommendations
 * (PI-0006B-FOLLOWUP), not just new-entry screening, a position
 * already being held shouldn't flip aligned/against on a few noisy
 * days -- stability over responsiveness. /api/chart already pulls 6
 * months of daily bars (~126 trading days), comfortably covering a
 * 90-day window with no new data sourcing.
 */
export function classifyTrendFromCloses(closes: number[]): TrendClassification {
  if (closes.length < 90) {
    return { trend: 'unknown', strategy: 'NO_TRADE', confidence: 0, reason: 'Not enough data' };
  }

  const price = closes[closes.length - 1];
  const ma60 = avgNumbers(closes.slice(-60));
  const ma90 = avgNumbers(closes.slice(-90));
  const mom60 = (price - closes[closes.length - 61]) / closes[closes.length - 61];
  // Higher-lows/lower-highs confirmation keeps its original 20-day
  // granularity -- a minor confirmatory factor, not the primary trend
  // read Ian's stability concern was about, and 6mo of daily data
  // doesn't comfortably support widening this sub-signal too.
  const low20 = Math.min(...closes.slice(-20));
  const high20 = Math.max(...closes.slice(-20));
  const higherLows = low20 > Math.min(...closes.slice(-40, -20)) * 0.985;
  const lowerHighs = high20 < Math.max(...closes.slice(-40, -20)) * 1.015;

  let score = 0;
  if (price > ma60) score += 2; else score -= 2;
  if (price > ma90) score += 2; else score -= 2;
  if (ma60 > ma90) score += 2; else score -= 2;
  if (mom60 > 0.03) score += 2; else if (mom60 < -0.03) score -= 2;
  if (higherLows) score += 2; else if (lowerHighs) score -= 2;

  const confidence = Math.min(100, Math.abs(score) * 10);

  if (score >= 4) {
    return { trend: 'uptrend', strategy: 'BPS', confidence, reason: 'Price above MA60/MA90, positive momentum' };
  }
  if (score <= -4) {
    return { trend: 'downtrend', strategy: 'BCS', confidence, reason: 'Price below MA60/MA90, negative momentum' };
  }
  return { trend: 'sideways', strategy: 'IC', confidence, reason: 'Mixed signals, range-bound' };
}

export type TechnicalAlignment = 'aligned' | 'against' | 'neutral' | 'unknown';

// Strategies whose thesis benefits from an uptrend vs. a downtrend.
// PMCC's short-dated short call is managed like a covered call's short
// leg (per Ian's explicit guidance elsewhere in this codebase), but the
// POSITION as a whole is a long-dated bullish bet via the LEAPS leg --
// classified with the bullish set here, matching how the position's
// thesis (not its short leg's week-to-week management) relates to trend.
const BULLISH_STRATEGIES = new Set(['BPS', 'CSP', 'PMCC']);
const BEARISH_STRATEGIES = new Set(['BCS', 'CC']);

/**
 * Maps a trend direction and a POSITION's own strategy to whether the
 * trend supports or works against that position's thesis. This is a
 * distinct question from TrendClassification.strategy above (which
 * strategy the trend itself would favor for a NEW entry) -- this
 * function instead asks "does this EXISTING position's own strategy
 * agree with the trend."
 *
 * Single source of truth for both the screener's group-header trend
 * badge (SCREENER-TREND-BADGE-0001, blocked pending Quinn's batch-fetch
 * sizing) and the portfolio recommendation engine's technicalAlignment
 * input (PI-0006B-FOLLOWUP) -- per Ian's sign-off requirement, do not
 * reimplement this mapping a second time at either call site.
 */
export function technicalAlignmentForStrategy(
  trend: TrendDirection,
  strategy: string | null | undefined,
): TechnicalAlignment {
  if (trend === 'unknown' || !strategy) return 'unknown';
  if (trend === 'sideways') return 'neutral';
  const bullish = BULLISH_STRATEGIES.has(strategy);
  const bearish = BEARISH_STRATEGIES.has(strategy);
  if (!bullish && !bearish) return 'neutral'; // IC and anything else: trend-agnostic by design
  if (trend === 'uptrend') return bullish ? 'aligned' : 'against';
  return bullish ? 'against' : 'aligned'; // downtrend
}


