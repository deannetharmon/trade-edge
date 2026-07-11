// lib/decision-engine/types.ts

import type {
  AutopilotCandidate,
  AutopilotStrategy,
  DecisionConfidenceBreakdown,
  OpportunityScoreBreakdown,
} from '@/lib/autopilot/types';

export type DecisionSubjectType =
  | 'portfolio'
  | 'position'
  | 'candidate'
  | 'pending_order';

export type DecisionObjective =
  | 'generate_income'
  | 'deploy_idle_cash'
  | 'acquire_shares'
  | 'protect_capital'
  | 'reduce_risk'
  | 'manage_position'
  | 'improve_diversification'
  | 'avoid_low_quality_trade';

export type DecisionAction =
  | 'WAIT'
  | 'BUY_SHARES'
  | 'SELL_CSP'
  | 'WRITE_CC'
  | 'OPEN_BPS'
  | 'OPEN_BCS'
  | 'OPEN_IC'
  | 'ROLL'
  | 'CLOSE'
  | 'MANAGE'
  | 'HOLD'
  | 'AVOID';

export type DecisionPriority = 'low' | 'normal' | 'high' | 'urgent';

export type EvidenceTone = 'positive' | 'neutral' | 'warning' | 'negative';

export interface DecisionSubject {
  type: DecisionSubjectType;
  id: string;
  symbol?: string;
  strategy?: AutopilotStrategy;
  label: string;
}

export interface DecisionConfidence {
  overall: number;
  market: number;
  portfolio: number;
  execution: number;
  income: number;
  risk: number;
  framework?: DecisionConfidenceBreakdown;
}

export interface DecisionEvidence {
  id: string;
  label: string;
  value?: string | number;
  tone: EvidenceTone;
  explanation?: string;
}

export interface DecisionConcern {
  id: string;
  label: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  explanation: string;
}

export interface DecisionAlternative {
  action: DecisionAction;
  strategy?: AutopilotStrategy;
  score: number;
  disposition: 'considered' | 'rejected' | 'not_available';
  reasons: string[];
}

export interface DecisionReviewTrigger {
  id: string;
  label: string;
  triggerType:
    | 'profit_target'
    | 'dte'
    | 'price'
    | 'earnings'
    | 'risk'
    | 'volatility'
    | 'manual';
  threshold?: string | number;
  explanation: string;
}

export interface ExpectedOutcome {
  intent: string;
  expectedCredit?: number;
  expectedAnnualizedReturnPct?: number;
  capitalRequired?: number;
  theoreticalMaxLoss?: number;
  assignmentProbabilityPct?: number;
  expectedHoldingDays?: number;
}

export interface DecisionRecommendation {
  action: DecisionAction;
  strategy?: AutopilotStrategy;
  summary: string;
  status: 'recommended' | 'conditional' | 'not_recommended';
}

export interface DecisionAnalysis {
  id: string;
  createdAt: string;
  version: 'decision-analysis-v1';
  subject: DecisionSubject;
  objective: DecisionObjective;
  recommendation: DecisionRecommendation;
  confidence: DecisionConfidence;
  priority: DecisionPriority;
  rationale: string;
  supportingEvidence: DecisionEvidence[];
  concerns: DecisionConcern[];
  alternatives: DecisionAlternative[];
  reviewTriggers: DecisionReviewTrigger[];
  expectedOutcome: ExpectedOutcome;
  opportunityScore?: OpportunityScoreBreakdown;
  candidate?: AutopilotCandidate;
  metadata: {
    source: 'portfolio' | 'screener' | 'hunter' | 'repeat_trades' | 'autopilot' | 'manual';
    executionAllowed: false;
    paperExecutionAllowed: false;
    rulesEvaluated: string[];
    rulesBlocked: string[];
  };
}

export interface SingleCandidateDecisionContext {
  candidate: AutopilotCandidate;
  objective: DecisionObjective;
  source?: DecisionAnalysis['metadata']['source'];
  portfolio: {
    netLiquidity: number;
    availableBuyingPower: number;
    existingSymbolExposure: number;
    sectorExposurePct?: number;
    maxSingleTickerPct: number;
    maxSectorPct: number;
  };
  market: {
    bias: 'bullish' | 'neutral' | 'bearish' | 'uncertain';
    earningsWithinExpiration: boolean;
    macroRiskElevated: boolean;
    volatilityStable: boolean;
  };
  preferences: {
    willingToOwn: boolean;
    preferDefinedRisk: boolean;
    minimumConfidence: number;
  };
  confidenceInput: {
    framework: DecisionConfidenceBreakdown;
  };
  opportunityScore: OpportunityScoreBreakdown;
}
