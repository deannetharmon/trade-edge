// lib/autopilot/scoring/opportunity.ts

import type { AutopilotCandidate, AutopilotConfig, OpportunityScoreBreakdown, PaperAccount } from '../types';

function clamp(value: number, min = 0, max = 100): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function average(values: number[]): number {
  const clean = values.filter((v) => Number.isFinite(v));
  if (!clean.length) return 0;
  return clean.reduce((a, b) => a + b, 0) / clean.length;
}

function postureMultiplier(config: AutopilotConfig): number {
  switch (config.portfolioRiskPosture) {
    case 'conserve': return 1.35;
    case 'maximize': return 0.75;
    case 'steady':
    default: return 1;
  }
}

function edgeScore(candidate: AutopilotCandidate): number {
  const popScore = clamp(candidate.pop ?? 0, 0, 100);
  const rocScore = clamp((candidate.roc ?? 0) * 8, 0, 100);
  const ivrScore = clamp(candidate.ivr ?? candidate.annualizedYield ?? 0, 0, 100);
  const technicalScore = clamp(candidate.technicalFit ?? 50, 0, 100);
  return average([popScore, rocScore, ivrScore, technicalScore]);
}

function goalAlignmentFactor(candidate: AutopilotCandidate, config: AutopilotConfig): number {
  const configuredGoal = config.perStrategyGoal[candidate.strategy];
  const explicit = candidate.goalAlignment;
  if (Number.isFinite(explicit ?? NaN)) return clamp(explicit as number, 0.5, 1.5);

  if (configuredGoal === 'acquire' && (candidate.strategy === 'CSP' || candidate.strategy === 'CC')) return 1.15;
  if (configuredGoal === 'conserve') return 0.9;
  if (configuredGoal === 'maximize') return 1.1;
  return 1;
}

function riskPenalty(candidate: AutopilotCandidate, account: PaperAccount): number {
  const concentrationPenalty = clamp(candidate.concentrationPenalty ?? 0, 0, 100);
  const correlationPenalty = clamp(candidate.correlationPenalty ?? 0, 0, 100);
  const deltaPenalty = clamp(Math.abs(candidate.betaWeightedDelta ?? 0), 0, 100) * 0.25;
  const sizePenalty = account.currentBalance > 0
    ? clamp((candidate.theoreticalMaxLoss / account.currentBalance) * 100, 0, 100)
    : 100;

  return average([concentrationPenalty, correlationPenalty, deltaPenalty, sizePenalty]);
}

export function calculateOpportunityScore(
  candidate: AutopilotCandidate,
  config: AutopilotConfig,
  account: PaperAccount,
): OpportunityScoreBreakdown {
  const notes: string[] = [];
  const edge = edgeScore(candidate);
  const factor = goalAlignmentFactor(candidate, config);
  const penalty = riskPenalty(candidate, account);
  const multiplier = postureMultiplier(config);
  const raw = (edge * factor) - (penalty * multiplier);
  const total = clamp(raw, 0, 100);

  if (total === 0) notes.push('Opportunity score is zero after risk adjustment.');
  else notes.push('Opportunity score calculated by framework model.');

  return {
    total,
    edgeScore: edge,
    goalAlignmentFactor: factor,
    riskContributionPenalty: penalty,
    postureMultiplier: multiplier,
    notes,
  };
}
