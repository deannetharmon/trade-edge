// lib/positionValuation/computePositionValuation.ts
//
// PI-0014: pure valuation math -- no fetching, no recommendation logic, no
// knowledge of the Decision Engine. See types.ts's module doc for why
// `liquidityTrapTriggered` is attached separately from the rest of this
// object, by attachLiquidityTrapTrigger() below, once a caller has actually
// run the marketable-aware recommendation comparison.

import { LIQUIDITY_TIER_THRESHOLDS, type LiquidityTier, type PositionValuation, type PositionValuationInput } from './types';

export type RawPositionValuation = Omit<PositionValuation, 'liquidityTrapTriggered'>;

function classifyLiquidityTier(slippagePercentOfMaxRisk: number): LiquidityTier {
  if (slippagePercentOfMaxRisk > LIQUIDITY_TIER_THRESHOLDS.liquidityTrapAt) return 'LIQUIDITY_TRAP';
  if (slippagePercentOfMaxRisk > LIQUIDITY_TIER_THRESHOLDS.wideSpreadAt) return 'WIDE_SPREAD';
  return 'LIQUID';
}

// Computes everything except liquidityTrapTriggered. midValue/marketableValue
// are expected in the same "positive, absolute buyback cost" convention
// app/portfolio/page.tsx's currentValue/closeValue already use -- this
// function does no sign-normalization of its own beyond that assumption.
export function computePositionValuation(input: PositionValuationInput): RawPositionValuation {
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

// Second, tiny pure function: attaches the one decision-dependent field.
// `verdictPromotedByMarketable` is supplied by the caller (evaluatePositionObjective(),
// the canonical Decision Engine) once it knows whether marketable evidence
// actually changed the recommendation relative to mid alone -- see that
// module's `executionRealityPromoted` return value.
export function attachLiquidityTrapTrigger(
  raw: RawPositionValuation,
  verdictPromotedByMarketable: boolean,
): PositionValuation {
  return {
    ...raw,
    liquidityTrapTriggered: raw.liquidityTier === 'LIQUIDITY_TRAP' && verdictPromotedByMarketable,
  };
}
