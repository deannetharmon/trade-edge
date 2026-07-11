// lib/autopilot/decision/types.ts

import type { AutopilotConfig, AutopilotStrategy, PaperAccount } from '../types';
import type { DecisionAnalysis } from '@/lib/decision-engine';

export interface PortfolioStateSummary {
  userId: string;
  currentBalance: number;
  peakBalance: number;
  openPositionCount: number;
  closedPositionCount: number;
  openRisk: number;
  openRiskPct: number;
  drawdownPct: number;
  tickerExposure: Record<string, number>;
  strategyExposure: Record<AutopilotStrategy, number>;
  generatedAt: string;
}

// Still used for the narrow set of portfolio-discipline pre-gates
// (drawdown circuit breaker, per-trade max-loss %, correlation) that are not
// yet represented in lib/decision-engine's SingleCandidateDecisionContext.
// See recommendationEngine.ts PORTFOLIO_PRE_GATE_RULES for which rules from
// this result are actually treated as blocking post-reconciliation.
export interface RiskGateResult {
  passed: boolean;
  rule: string;
  message: string;
  severity: 'info' | 'warning' | 'block';
}

// NOTE: AutopilotRecommendation (the pre-reconciliation output model) has been
// removed. lib/decision-engine's DecisionAnalysis is now the canonical
// recommendation output contract for both Autopilot and every other TradeEdge
// surface (Portfolio, Screener, Hunter, Repeat Trades, Pending Orders). See
// docs/design/DR-0002-TradeEdge-Decision-Engine-v1.md.

export interface RecommendationRunResult {
  runId: string;
  timestamp: string;
  userId: string;
  mode: 'paper';
  liveTradingEnabled: false;
  config: AutopilotConfig;
  portfolioState: PortfolioStateSummary;
  account: PaperAccount;
  candidatesScanned: number;
  approvedCount: number;
  rejectedCount: number;
  suppressedCount: number;
  recommendations: DecisionAnalysis[];
}
