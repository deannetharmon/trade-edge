// lib/positionValuation/computePositionValuation.ts
//
// PI-0014: pure valuation math -- no fetching, no recommendation logic, no
// knowledge of the Decision Engine. See types.ts's module doc: this module
// produces a purely observational PositionValuation; whether marketable
// evidence changed a recommendation is decided (and owned) by
// lib/portfolio-intelligence/objectives/positionObjective.ts, not here.

import { LIQUIDITY_TIER_THRESHOLDS, type LiquidityTier, type PositionValuation, type PositionValuationInput } from './types';

// PI-0014 corrective closeout: hasValidMaxRisk gates classification itself,
// not just the ratio feeding it. A missing/zero/negative maxRisk means the
// denominator is unusable -- that is an absence of risk information, not
// evidence of a tight spread, so it must not silently read as 'LIQUID'
// (the best tier). Returns null (unknown) rather than inventing a
// dollar-based fallback threshold.
function classifyLiquidityTier(slippagePercentOfMaxRisk: number, hasValidMaxRisk: boolean): LiquidityTier | null {
  if (!hasValidMaxRisk) return null;
  if (slippagePercentOfMaxRisk > LIQUIDITY_TIER_THRESHOLDS.liquidityTrapAt) return 'LIQUIDITY_TRAP';
  if (slippagePercentOfMaxRisk > LIQUIDITY_TIER_THRESHOLDS.wideSpreadAt) return 'WIDE_SPREAD';
  return 'LIQUID';
}

// midValue/marketableValue are expected in the same "positive, absolute
// buyback cost" convention app/portfolio/page.tsx's currentValue/closeValue
// already use -- this function does no sign-normalization of its own beyond
// that assumption.
export function computePositionValuation(input: PositionValuationInput): PositionValuation {
  const { creditReceived, midValue, marketableValue, maxRisk } = input;

  const midPnL = creditReceived - midValue;
  const marketablePnL = creditReceived - marketableValue;

  // Execution reality is never "worse than zero cost" from a risk-evidence
  // standpoint -- if marketable happens to come in better than mid (an
  // uncommon edge case), there is no slippage cost to report, not a negative
  // one.
  const slippageCost = Math.max(0, midPnL - marketablePnL);
  const hasValidMaxRisk = maxRisk != null && maxRisk > 0;
  // slippagePercentOfMaxRisk itself stays 0 (never a divide-by-zero, never
  // fabricated) when maxRisk is unusable -- unchanged from the original
  // implementation. Only the tier classification derived from it (below)
  // was corrected to distinguish "known to be tight" from "unknown."
  const slippagePercentOfMaxRisk = hasValidMaxRisk ? slippageCost / maxRisk : 0;
  const liquidityTier = classifyLiquidityTier(slippagePercentOfMaxRisk, hasValidMaxRisk);

  return { midValue, midPnL, marketableValue, marketablePnL, slippageCost, slippagePercentOfMaxRisk, liquidityTier };
}
