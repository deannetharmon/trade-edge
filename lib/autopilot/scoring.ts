// lib/autopilot/scoring.ts

import type {
  AutopilotCandidate,
  AutopilotConfig,
  DecisionConfidenceBreakdown,
  DecisionConfidenceInput,
  OpportunityScoreBreakdown,
  PaperAccount,
} from './types';

function clamp(value: number, min = 0, max = 100): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function hoursBetween(a: Date, b: Date): number {
  return Math.abs(a.getTime() - b.getTime()) / 36e5;
}

export function getRegimeAwareDeltaBand(vix: number): { min: number; max: number; label: string } {
  if (vix < 18) return { min: 0.15, max: 0.20, label: 'low-vix' };
  if (vix <= 30) return { min: 0.18, max: 0.25, label: 'normal-vix' };
  return { min: 0.10, max: 0.18, label: 'high-vix' };
}

export function calculateNetEdge(theta: number, gamma: number, expectedDailyMove: number): number {
  return theta - (0.5 * Math.abs(gamma) * Math.pow(expectedDailyMove, 2));
}

export function calculateDecisionConfidence(input: DecisionConfidenceInput): DecisionConfidenceBreakdown {
  const now = input.now ?? new Date();
  const notes: string[] = [];

  const spreadRatios = input.legs.map((leg) => {
    if (!leg.averageBidAskSpread20 || leg.averageBidAskSpread20 <= 0) return 2.01;
    return leg.bidAskSpread / leg.averageBidAskSpread20;
  });
  const worstSpreadRatio = spreadRatios.length ? Math.max(...spreadRatios) : 2.01;
  let liquidityScore = 0;
  if (worstSpreadRatio <= 1.1) liquidityScore = 40;
  else if (worstSpreadRatio <= 1.25) liquidityScore = 32;
  else if (worstSpreadRatio <= 1.5) liquidityScore = 24;
  else if (worstSpreadRatio <= 2.0) liquidityScore = 12;
  else liquidityScore = 0;
  notes.push(`Liquidity worst spread ratio ${worstSpreadRatio.toFixed(2)}x = ${liquidityScore}/40`);

  const quoteAgesSeconds = input.legs.map((leg) => {
    if (!leg.quoteTimestamp) return Number.POSITIVE_INFINITY;
    return Math.max(0, (now.getTime() - new Date(leg.quoteTimestamp).getTime()) / 1000);
  });
  const worstQuoteAge = quoteAgesSeconds.length ? Math.max(...quoteAgesSeconds) : Number.POSITIVE_INFINITY;
  let latencyScore = 0;
  if (worstQuoteAge <= 15) latencyScore = 20;
  else if (worstQuoteAge <= 30) latencyScore = 16;
  else if (worstQuoteAge <= 60) latencyScore = 10;
  else if (worstQuoteAge <= 120) latencyScore = 5;
  else latencyScore = 0;
  notes.push(`Data freshness worst quote age ${Number.isFinite(worstQuoteAge) ? `${Math.round(worstQuoteAge)}s` : 'missing'} = ${latencyScore}/20`);

  let macroProximityScore = 20;
  if (input.nextMacroEventAt) {
    const eventTime = new Date(input.nextMacroEventAt);
    const hoursToEvent = hoursBetween(now, eventTime);
    const hardGateHours = input.hardMacroGateHours ?? 24;
    if (hoursToEvent <= hardGateHours) macroProximityScore = 0;
    else if (hoursToEvent <= hardGateHours + 12) macroProximityScore = 8;
    else if (hoursToEvent <= hardGateHours + 24) macroProximityScore = 14;
    else macroProximityScore = 20;
    notes.push(`Macro proximity ${hoursToEvent.toFixed(1)}h from event = ${macroProximityScore}/20`);
  } else {
    notes.push('No scheduled macro event supplied = 20/20');
  }

  const vixChangePct = input.vixNow && input.vixThirtyMinutesAgo
    ? Math.abs((input.vixNow - input.vixThirtyMinutesAgo) / input.vixThirtyMinutesAgo) * 100
    : null;
  const ivChangePct = input.underlyingIvNow && input.underlyingIvThirtyMinutesAgo
    ? Math.abs((input.underlyingIvNow - input.underlyingIvThirtyMinutesAgo) / input.underlyingIvThirtyMinutesAgo) * 100
    : null;
  const volatilityChangePct = Math.max(vixChangePct ?? 0, ivChangePct ?? 0);
  let volatilityStabilityScore = 0;
  if (volatilityChangePct <= 2) volatilityStabilityScore = 20;
  else if (volatilityChangePct <= 5) volatilityStabilityScore = 15;
  else if (volatilityChangePct <= 10) volatilityStabilityScore = 8;
  else if (volatilityChangePct <= 20) volatilityStabilityScore = 3;
  else volatilityStabilityScore = 0;
  notes.push(`Volatility 30m change ${volatilityChangePct.toFixed(1)}% = ${volatilityStabilityScore}/20`);

  const total = Math.round(clamp(liquidityScore + latencyScore + macroProximityScore + volatilityStabilityScore));

  return {
    total,
    liquidityScore,
    latencyScore,
    macroProximityScore,
    volatilityStabilityScore,
    notes,
  };
}

export function calculateOpportunityScore(
  candidate: AutopilotCandidate,
  config: AutopilotConfig,
  account: PaperAccount
): OpportunityScoreBreakdown {
  const notes: string[] = [];
  const popScore = clamp(candidate.pop ?? 70, 0, 100) * 0.35;
  const rocScore = clamp((candidate.roc ?? candidate.annualizedYield ?? 10) * 4, 0, 100) * 0.30;
  const ivScore = clamp(candidate.ivr ?? 35, 0, 100) * 0.15;
  const technicalScore = clamp(candidate.technicalFit ?? 70, 0, 100) * 0.20;
  const edgeScore = clamp(popScore + rocScore + ivScore + technicalScore);
  notes.push(`Edge ${edgeScore.toFixed(1)} from POP/ROC/IV/technical inputs`);

  const configuredGoal = config.perStrategyGoal[candidate.strategy];
  const rawGoalAlignment = candidate.goalAlignment ?? 1;
  const goalAlignmentFactor = clamp(rawGoalAlignment, 0.5, 1.5);
  notes.push(`${candidate.strategy} goal ${configuredGoal}; alignment factor ${goalAlignmentFactor.toFixed(2)}`);

  const concentrationPenalty = clamp(candidate.concentrationPenalty ?? 0, 0, 100) * 0.45;
  const correlationPenalty = clamp(candidate.correlationPenalty ?? 0, 0, 100) * 0.35;
  const deltaPenalty = clamp(Math.abs(candidate.betaWeightedDelta ?? 0), 0, 100) * 0.20;
  const riskContributionPenalty = clamp(concentrationPenalty + correlationPenalty + deltaPenalty);

  const postureMultiplier = config.portfolioRiskPosture === 'conserve' ? 1.35 : config.portfolioRiskPosture === 'maximize' ? 0.75 : 1;
  notes.push(`Risk penalty ${riskContributionPenalty.toFixed(1)} x posture ${postureMultiplier.toFixed(2)}`);

  const maxLossAllowed = account.currentBalance * (config.thresholds.perTradeMaxLossPctEquity / 100);
  let total = (edgeScore * goalAlignmentFactor) - (riskContributionPenalty * postureMultiplier);
  if (candidate.theoreticalMaxLoss > maxLossAllowed) {
    total = 0;
    notes.push(`Skipped: max loss ${candidate.theoreticalMaxLoss.toFixed(2)} exceeds cap ${maxLossAllowed.toFixed(2)}`);
  }

  return {
    total: Math.round(clamp(total)),
    edgeScore: Math.round(edgeScore),
    goalAlignmentFactor,
    riskContributionPenalty: Math.round(riskContributionPenalty),
    postureMultiplier,
    notes,
  };
}
