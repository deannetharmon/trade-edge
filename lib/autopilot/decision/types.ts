// lib/autopilot/decision/types.ts

import type {
  AutopilotCandidate,
  AutopilotConfig,
  AutopilotStrategy,
  DecisionConfidenceBreakdown,
  OpportunityScoreBreakdown,
  PaperAccount,
} from '../types';

export type RecommendationStatus = 'approved' | 'rejected' | 'suppressed';

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

export interface RiskGateResult {
  passed: boolean;
  rule: string;
  message: string;
  severity: 'info' | 'warning' | 'block';
}

export interface AutopilotRecommendation {
  id: string;
  candidate: AutopilotCandidate;
  status: RecommendationStatus;
  rank: number | null;
  opportunity: OpportunityScoreBreakdown;
  confidence: DecisionConfidenceBreakdown;
  riskGates: RiskGateResult[];
  reasons: string[];
  createdAt: string;
}

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
  recommendations: AutopilotRecommendation[];
}
