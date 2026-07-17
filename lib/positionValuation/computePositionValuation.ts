// lib/positionValuation/computePositionValuation.ts
//
// PI-0014: pure valuation math -- no fetching, no recommendation logic, no
// knowledge of the Decision Engine. See types.ts's module doc: this module
// produces a purely observational PositionValuation; whether marketable
// evidence changed a recommendation is decided (and owned) by
// lib/portfolio-intelligence/objectives/positionObjective.ts, not here.

import { LIQUIDITY_TIER_THRESHOLDS, type LiquidityTier, type PositionValuation, type PositionValuationInput } from './types';

function classifyLiquidityTier(slippagePercentOfMaxRisk: number): LiquidityTier {
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
  const slippagePercentOfMaxRisk = maxRisk != null && maxRisk > 0 ? slippageCost / maxRisk : 0;
  const liquidityTier = classifyLiquidityTier(slippagePercentOfMaxRisk);

  return { midValue, midPnL, marketableValue, marketablePnL, slippageCost, slippagePercentOfMaxRisk, liquidityTier };
}
