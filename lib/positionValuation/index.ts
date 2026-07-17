// lib/positionValuation/index.ts
//
// PI-0014: Marketable Pricing for Risk-Gating (Phase 1). See
// docs/design/PI-0014-Marketable-Pricing-Risk-Gating.md. One-way
// dependency, matching every other lib/ orchestration package in this
// repo: app/portfolio/page.tsx and lib/portfolio-intelligence depend on
// this module; nothing here ever imports from either of those.

export { computePositionValuation, attachLiquidityTrapTrigger } from './computePositionValuation';
export type { RawPositionValuation } from './computePositionValuation';
export type { PositionValuation, PositionValuationInput, LiquidityTier } from './types';
export { LIQUIDITY_TIER_THRESHOLDS } from './types';
