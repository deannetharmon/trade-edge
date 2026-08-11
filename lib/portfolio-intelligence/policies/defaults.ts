// lib/portfolio-intelligence/policies/defaults.ts
//
// Default values are chosen to exactly match what was already in production
// use before PI-0003 -- this file formalizes existing magic numbers into
// named, typed, documented policy objects. It does not change any default
// value. See types.ts for why materialLossPct and candidateMaterialLossPct
// are deliberately different numbers.

import type { PortfolioRiskPolicy, PositionManagementPolicy } from './types';

// Matches the exact thresholds evaluatePositionObjective() used before this
// slice (consolidated from TE-0006B in PI-0002).
export const DEFAULT_POSITION_MANAGEMENT_POLICY: PositionManagementPolicy = {
  profitTargetPct: 50,
  dteReviewThreshold: 21,
  materialLossPct: -100,
  weakHealthLossPct: -50,
  weakHealthScoreThreshold: 50,
  watchHealthScoreThreshold: 75,
  actionHealthScoreThreshold: 40,
  // PI-0004B: new policy value, not a pre-existing magic number formalized --
  // 10 calendar days is chosen to sit comfortably inside the existing
  // 21-DTE management window (so a trader already reviewing a position for
  // DTE reasons around then also sees earnings context) while staying well
  // outside "not imminent" territory for a healthy position.
  earningsReviewWindowDays: 10,
  // PI-0014C: recommendation-only freshness boundary. Two minutes permits
  // ordinary polling/network delay while still requiring a recent broker
  // observation before marketable pricing may promote a hard action.
  marketableQuoteMaxAgeMs: 120_000,
  marketableQuoteFutureSkewToleranceMs: 1_000,
};

// Matches AutopilotThresholds defaults (bpUtilizationMaxPct: 65,
// monthlyDrawdownDefensivePct: 8, singleTickerMaxPct: 10, sectorMaxPct: 25)
// and PI-0001's PortfolioIntelligenceThresholds defaults, so all three
// layers of this codebase agree on what these terms mean.
export const DEFAULT_PORTFOLIO_RISK_POLICY: PortfolioRiskPolicy = {
  maxBuyingPowerUtilizationPct: 65,
  maxSymbolConcentrationPct: 10,
  maxSectorConcentrationPct: 25,
  defensiveDrawdownPct: 8,
  idleCashThresholdPct: 15,
  maxNewCandidateRiskPct: 10,
  candidateMaterialLossPct: -200,
};
