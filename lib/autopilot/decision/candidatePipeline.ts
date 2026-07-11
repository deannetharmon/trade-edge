// lib/autopilot/decision/candidatePipeline.ts

import type { AutopilotCandidate } from '../types';
import type {
  CandidatePipelineInput,
  CandidatePipelineMetadata,
  CandidatePipelineResult,
  CandidatePortfolioContext,
  CandidateValidationIssue,
  DuplicateCandidateRecord,
  PipelineCandidate,
} from './candidatePipelineTypes';

function createPipelineId(): string {
  return `pipe_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 10)}`;
}

function safeNumber(value: number | undefined | null): number {
  return Number.isFinite(value) ? Number(value) : 0;
}

function normalizeSymbol(symbol: string): string {
  return symbol.trim().toUpperCase();
}

function normalizeCandidate(candidate: AutopilotCandidate): AutopilotCandidate {
  const symbol = normalizeSymbol(candidate.symbol);

  return {
    ...candidate,
    symbol,
    underlyingPrice: safeNumber(candidate.underlyingPrice),
    estimatedCredit: safeNumber(candidate.estimatedCredit),
    theoreticalMaxLoss: Math.max(0, safeNumber(candidate.theoreticalMaxLoss)),
    pop: candidate.pop === undefined ? undefined : safeNumber(candidate.pop),
    roc: candidate.roc === undefined ? undefined : safeNumber(candidate.roc),
    ivr: candidate.ivr === undefined ? undefined : safeNumber(candidate.ivr),
    annualizedYield:
      candidate.annualizedYield === undefined
        ? undefined
        : safeNumber(candidate.annualizedYield),
    technicalFit:
      candidate.technicalFit === undefined
        ? undefined
        : safeNumber(candidate.technicalFit),
    goalAlignment:
      candidate.goalAlignment === undefined
        ? undefined
        : safeNumber(candidate.goalAlignment),
    correlationPenalty:
      candidate.correlationPenalty === undefined
        ? undefined
        : safeNumber(candidate.correlationPenalty),
    concentrationPenalty:
      candidate.concentrationPenalty === undefined
        ? undefined
        : safeNumber(candidate.concentrationPenalty),
    betaWeightedDelta:
      candidate.betaWeightedDelta === undefined
        ? undefined
        : safeNumber(candidate.betaWeightedDelta),
    legs: candidate.legs.map((leg) => ({
      ...leg,
      symbol: normalizeSymbol(leg.symbol),
      underlyingSymbol: normalizeSymbol(leg.underlyingSymbol),
      quantity: Math.max(0, safeNumber(leg.quantity)),
      strike: leg.strike === undefined ? undefined : safeNumber(leg.strike),
      delta: leg.delta === undefined ? undefined : safeNumber(leg.delta),
      gamma: leg.gamma === undefined ? undefined : safeNumber(leg.gamma),
      theta: leg.theta === undefined ? undefined : safeNumber(leg.theta),
      vega: leg.vega === undefined ? undefined : safeNumber(leg.vega),
      bid: leg.bid === undefined ? undefined : safeNumber(leg.bid),
      ask: leg.ask === undefined ? undefined : safeNumber(leg.ask),
      mid: leg.mid === undefined ? undefined : safeNumber(leg.mid),
    })),
  };
}

function validateCandidate(
  candidate: AutopilotCandidate,
): CandidateValidationIssue[] {
  const issues: CandidateValidationIssue[] = [];

  if (!candidate.id) {
    issues.push({
      field: 'id',
      severity: 'block',
      message: 'Candidate is missing an id.',
    });
  }

  if (!candidate.symbol) {
    issues.push({
      field: 'symbol',
      severity: 'block',
      message: 'Candidate is missing a symbol.',
    });
  }

  if (!candidate.strategy) {
    issues.push({
      field: 'strategy',
      severity: 'block',
      message: 'Candidate is missing a strategy.',
    });
  }

  if (!Number.isFinite(candidate.underlyingPrice) || candidate.underlyingPrice <= 0) {
    issues.push({
      field: 'underlyingPrice',
      severity: 'block',
      message: 'Underlying price must be greater than zero.',
    });
  }

  if (!Number.isFinite(candidate.theoreticalMaxLoss) || candidate.theoreticalMaxLoss < 0) {
    issues.push({
      field: 'theoreticalMaxLoss',
      severity: 'block',
      message: 'Theoretical max loss must be zero or greater.',
    });
  }

  if (!candidate.legs.length) {
    issues.push({
      field: 'legs',
      severity: 'block',
      message: 'Candidate must include at least one leg.',
    });
  }

  for (let index = 0; index < candidate.legs.length; index++) {
    const leg = candidate.legs[index];
    if (!leg.symbol || !leg.underlyingSymbol) {
      issues.push({
        field: `legs[${index}]`,
        severity: 'block',
        message: 'Leg is missing symbol or underlying symbol.',
      });
    }

    if (!Number.isFinite(leg.quantity) || leg.quantity <= 0) {
      issues.push({
        field: `legs[${index}].quantity`,
        severity: 'block',
        message: 'Leg quantity must be greater than zero.',
      });
    }

    if (leg.assetType === 'option' && !leg.optionType) {
      issues.push({
        field: `legs[${index}].optionType`,
        severity: 'block',
        message: 'Option leg is missing option type.',
      });
    }
  }

  if (!candidate.sector) {
    issues.push({
      field: 'sector',
      severity: 'warning',
      message: 'Sector metadata is missing; sector cap checks may be incomplete.',
    });
  }

  return issues;
}

function buildPortfolioContext(
  candidate: AutopilotCandidate,
  portfolio: CandidatePipelineInput['portfolio'],
): CandidatePortfolioContext {
  const currentTickerExposure = portfolio.tickerExposure[candidate.symbol] ?? 0;
  const candidateRisk = Math.max(0, candidate.theoreticalMaxLoss);
  const projectedTickerExposure = currentTickerExposure + candidateRisk;
  const projectedOpenRisk = portfolio.openRisk + candidateRisk;

  return {
    currentTickerExposure,
    projectedTickerExposure,
    currentOpenRiskPct: portfolio.openRiskPct,
    projectedOpenRiskPct:
      portfolio.currentBalance > 0
        ? (projectedOpenRisk / portfolio.currentBalance) * 100
        : 0,
    drawdownPct: portfolio.drawdownPct,
  };
}

function buildPipelineCandidate(
  candidate: AutopilotCandidate,
  input: CandidatePipelineInput,
): PipelineCandidate {
  const normalized = normalizeCandidate(candidate);
  const validationIssues = validateCandidate(normalized);
  const isValid = !validationIssues.some((issue) => issue.severity === 'block');

  const metadata: CandidatePipelineMetadata = {
    pipelineId: createPipelineId(),
    source: input.source ?? 'unknown',
    processedAt: new Date().toISOString(),
    pipelineVersion: 'sprint-2-v1',
  };

  return {
    original: candidate,
    normalized,
    isValid,
    validationIssues,
    portfolioContext: buildPortfolioContext(normalized, input.portfolio),
    metadata,
  };
}

function dedupeCandidates(candidates: PipelineCandidate[]): {
  deduped: PipelineCandidate[];
  duplicates: DuplicateCandidateRecord[];
} {
  const retainedByKey = new Map<string, PipelineCandidate>();
  const deduped: PipelineCandidate[] = [];
  const duplicates: DuplicateCandidateRecord[] = [];

  for (const candidate of candidates) {
    const key = [
      candidate.normalized.symbol,
      candidate.normalized.strategy,
      candidate.normalized.legs
        .map((leg) => `${leg.direction}:${leg.optionType ?? 'stock'}:${leg.strike ?? 'na'}`)
        .join('|'),
    ].join('::');

    const retained = retainedByKey.get(key);
    if (retained) {
      duplicates.push({
        droppedCandidateId: candidate.normalized.id,
        retainedCandidateId: retained.normalized.id,
        dedupeKey: key,
        reason: 'duplicate_candidate',
      });
      continue;
    }

    retainedByKey.set(key, candidate);
    deduped.push(candidate);
  }

  return { deduped, duplicates };
}

export function runCandidatePipeline(
  input: CandidatePipelineInput,
): CandidatePipelineResult {
  const processed = input.candidates.map((candidate) =>
    buildPipelineCandidate(candidate, input),
  );

  const { deduped, duplicates } = dedupeCandidates(processed);

  const accepted = deduped.filter((candidate) => candidate.isValid);
  const rejected = deduped.filter((candidate) => !candidate.isValid);

  return {
    accepted,
    rejected,
    duplicates,
    totalReceived: input.candidates.length,
    totalAccepted: accepted.length,
    totalRejected: rejected.length,
    totalDuplicates: duplicates.length,
  };
}
