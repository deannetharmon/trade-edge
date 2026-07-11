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

// Emitted for every candidate the pipeline drops as a duplicate of one
// already seen in the same batch. A duplicate never reaches validation or
// the shared Decision Engine -- it does not get a DecisionAnalysis -- but it
// must still be inspectable: which candidate was dropped, which one was kept
// in its place, and the exact key that made them collide.
export interface DuplicateCandidateRecord {
  droppedCandidateId: string;
  retainedCandidateId: string;
  dedupeKey: string;
  reason: 'duplicate_candidate';
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
  duplicates: DuplicateCandidateRecord[];
  totalReceived: number;
  totalAccepted: number;
  totalRejected: number;
  // totalReceived === totalAccepted + totalRejected + totalDuplicates always
  // holds -- every candidate that comes in is accounted for exactly once as
  // accepted, rejected, or a recorded duplicate. Never silently dropped.
  totalDuplicates: number;
}

export interface CandidatePipelineInput {
  candidates: AutopilotCandidate[];
  portfolio: PortfolioStateSummary;
  source?: CandidateSource;
}
