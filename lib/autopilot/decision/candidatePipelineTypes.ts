// lib/autopilot/decision/candidatePipelineTypes.ts

import type { AutopilotCandidate } from '../types';
import type { PortfolioStateSummary } from './types';

export type CandidateSource =
  | 'manual'
  | 'screener'
  | 'watchlist'
  | 'repeat_trades'
  | 'engine'
  | 'unknown';

export interface CandidateValidationIssue {
  field: string;
  message: string;
  severity: 'warning' | 'block';
}

export interface CandidatePipelineMetadata {
  pipelineId: string;
  source: CandidateSource;
  processedAt: string;
  pipelineVersion: 'sprint-2-v1';
}

export interface CandidatePortfolioContext {
  currentTickerExposure: number;
  projectedTickerExposure: number;
  currentOpenRiskPct: number;
  projectedOpenRiskPct: number;
  drawdownPct: number;
}

export interface PipelineCandidate {
  original: AutopilotCandidate;
  normalized: AutopilotCandidate;
  isValid: boolean;
  validationIssues: CandidateValidationIssue[];
  portfolioContext: CandidatePortfolioContext;
  metadata: CandidatePipelineMetadata;
}

export interface CandidatePipelineResult {
  accepted: PipelineCandidate[];
  rejected: PipelineCandidate[];
  totalReceived: number;
  totalAccepted: number;
  totalRejected: number;
}

export interface CandidatePipelineInput {
  candidates: AutopilotCandidate[];
  portfolio: PortfolioStateSummary;
  source?: CandidateSource;
}
