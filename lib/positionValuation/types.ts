// lib/positionValuation/types.ts
//
// PI-0014: Marketable Pricing for Risk-Gating (Phase 1). See
// docs/design/PI-0014-Marketable-Pricing-Risk-Gating.md for the full
// rationale and the external architecture review this shape comes from
// (TradeEdge_Final_Architecture_Rulings.md, Decision 2).
//
// PI-0014 follow-up (Product Owner review): PositionValuation is purely
// observational -- valuation arithmetic only, no opinion on recommendations,
// thresholds, or the Decision Engine. Whether marketable evidence actually
// changed a recommendation (`liquidityTrapTriggered`) is a decision-engine
// property, not a valuation property, and now lives on
// PositionObjectiveResult in lib/portfolio-intelligence/objectives/
// positionObjective.ts, which imports LiquidityTier (below) as one more
// piece of input evidence -- see that file's module doc for the full
// dependency-flow rationale.

// Fixed percentage-of-max-risk tiers (Decision 1 of the final ruling).
// Display-only classification -- always computed, independent of whether it
// changes any recommendation.
export type LiquidityTier = 'LIQUID' | 'WIDE_SPREAD' | 'LIQUIDITY_TRAP';

export interface PositionValuation {
  midValue: number;
  midPnL: number;

  marketableValue: number;
  marketablePnL: number;

  // Absolute dollar cost of execution reality vs. theoretical mid, clamped
  // to >= 0 -- if marketable pricing happens to look better than mid (an
  // edge case, not the normal wide-spread-hurts-you direction), there is no
  // such thing as negative slippage cost from a risk-evidence standpoint.
  slippageCost: number;
  // slippageCost normalized against this position's own max risk. 0 when
  // maxRisk is unavailable or non-positive -- never a divide-by-zero, never
  // fabricated (same convention lib/portfolio-intelligence's
  // balancesNormalization.ts already uses for its own percentage fields).
  slippagePercentOfMaxRisk: number;

  liquidityTier: LiquidityTier;
}

// Raw inputs a caller already has on hand -- creditReceived (positive,
// absolute), midValue/marketableValue (positive, absolute buyback costs,
// matching the exact convention app/portfolio/page.tsx already uses for
// currentValue/closeValue), and maxRisk (already computed by
// calculateMaxRisk() there). No fetching, no re-derivation of prices here.
export interface PositionValuationInput {
  creditReceived: number;
  midValue: number;
  marketableValue: number;
  maxRisk: number | null;
}

// LIQUID < 5% of max risk, WIDE_SPREAD 5-15%, LIQUIDITY_TRAP > 15% -- exact
// thresholds from the final ruling (Decision 1).
export const LIQUIDITY_TIER_THRESHOLDS = {
  wideSpreadAt: 0.05,
  liquidityTrapAt: 0.15,
} as const;
