// lib/decision-engine/evaluateSingleCandidate.ts

import type { AutopilotStrategy } from '@/lib/autopilot/types';
import type {
  DecisionAction,
  DecisionAlternative,
  DecisionAnalysis,
  DecisionConcern,
  DecisionEvidence,
  DecisionReviewTrigger,
  SingleCandidateDecisionContext,
} from './types';

function clamp(value: number, min = 0, max = 100): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function createId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}

function actionForStrategy(strategy: AutopilotStrategy): DecisionAction {
  switch (strategy) {
    case 'CSP':
      return 'SELL_CSP';
    case 'CC':
      return 'WRITE_CC';
    case 'BPS':
      return 'OPEN_BPS';
    case 'BCS':
      return 'OPEN_BCS';
    case 'IC':
      return 'OPEN_IC';
    case 'PMCC':
      return 'OPEN_PMCC';
  }
}

function inferAssignmentProbability(pop?: number): number | undefined {
  if (!Number.isFinite(pop ?? NaN)) return undefined;
  return clamp(100 - Number(pop));
}

function buildEvidence(context: SingleCandidateDecisionContext): DecisionEvidence[] {
  const { candidate, portfolio, market, opportunityScore } = context;
  const evidence: DecisionEvidence[] = [];

  if (Number.isFinite(candidate.pop ?? NaN)) {
    evidence.push({
      id: 'pop',
      label: 'Probability of profit',
      value: `${Number(candidate.pop).toFixed(0)}%`,
      tone: Number(candidate.pop) >= 70 ? 'positive' : 'warning',
    });
  }

  if (Number.isFinite(candidate.roc ?? NaN)) {
    evidence.push({
      id: 'roc',
      label: 'Return on capital',
      value: `${Number(candidate.roc).toFixed(1)}%`,
      tone: Number(candidate.roc) >= 3 ? 'positive' : 'neutral',
    });
  }

  if (Number.isFinite(candidate.ivr ?? NaN)) {
    evidence.push({
      id: 'ivr',
      label: 'IV rank',
      value: Number(candidate.ivr).toFixed(0),
      tone: Number(candidate.ivr) >= 30 ? 'positive' : 'neutral',
    });
  }

  evidence.push({
    id: 'buying-power',
    label: 'Available buying power',
    value: portfolio.availableBuyingPower,
    tone:
      portfolio.availableBuyingPower >= candidate.theoreticalMaxLoss
        ? 'positive'
        : 'negative',
  });

  evidence.push({
    id: 'earnings',
    label: 'Earnings before expiration',
    value: market.earningsWithinExpiration ? 'Yes' : 'No',
    tone: market.earningsWithinExpiration ? 'negative' : 'positive',
  });

  evidence.push({
    id: 'opportunity-score',
    label: 'Opportunity score',
    value: opportunityScore.total.toFixed(0),
    tone: opportunityScore.total >= 70 ? 'positive' : opportunityScore.total >= 50 ? 'neutral' : 'warning',
  });

  return evidence;
}

function buildConcerns(context: SingleCandidateDecisionContext): DecisionConcern[] {
  const { candidate, portfolio, market, preferences } = context;
  const concerns: DecisionConcern[] = [];
  const projectedExposure = portfolio.existingSymbolExposure + candidate.theoreticalMaxLoss;
  const projectedTickerPct =
    portfolio.netLiquidity > 0 ? (projectedExposure / portfolio.netLiquidity) * 100 : 100;

  if (projectedTickerPct > portfolio.maxSingleTickerPct) {
    concerns.push({
      id: 'single-ticker-concentration',
      label: 'Single-ticker concentration',
      severity: 'high',
      explanation: `Projected exposure is ${projectedTickerPct.toFixed(1)}%, above the ${portfolio.maxSingleTickerPct.toFixed(1)}% limit.`,
    });
  }

  if (
    Number.isFinite(portfolio.sectorExposurePct ?? NaN) &&
    Number(portfolio.sectorExposurePct) > portfolio.maxSectorPct
  ) {
    concerns.push({
      id: 'sector-concentration',
      label: 'Sector concentration',
      severity: 'high',
      explanation: `Current sector exposure is ${Number(portfolio.sectorExposurePct).toFixed(1)}%, above the ${portfolio.maxSectorPct.toFixed(1)}% limit.`,
    });
  }

  if (candidate.theoreticalMaxLoss > portfolio.availableBuyingPower) {
    concerns.push({
      id: 'buying-power',
      label: 'Insufficient buying power',
      severity: 'critical',
      explanation: 'The candidate requires more buying power than is currently available.',
    });
  }

  if (market.earningsWithinExpiration) {
    concerns.push({
      id: 'earnings-risk',
      label: 'Earnings risk',
      severity: 'critical',
      explanation: 'The option expires after a scheduled earnings event.',
    });
  }

  if (market.macroRiskElevated) {
    concerns.push({
      id: 'macro-risk',
      label: 'Elevated macro-event risk',
      severity: 'medium',
      explanation: 'A high-impact macro event is close enough to reduce decision quality.',
    });
  }

  if (!market.volatilityStable) {
    concerns.push({
      id: 'volatility-instability',
      label: 'Volatility instability',
      severity: 'medium',
      explanation: 'Recent volatility is changing quickly, which weakens entry confidence.',
    });
  }

  if (candidate.strategy === 'CSP' && !preferences.willingToOwn) {
    concerns.push({
      id: 'assignment-intent',
      label: 'Assignment conflicts with ownership intent',
      severity: 'critical',
      explanation: 'A cash-secured put should not be recommended when the trader is unwilling to own the shares.',
    });
  }

  if (preferences.preferDefinedRisk && candidate.strategy === 'CSP') {
    concerns.push({
      id: 'defined-risk-preference',
      label: 'Defined-risk preference',
      severity: 'low',
      explanation: 'A bull put spread may better match the trader’s preference for capped risk.',
    });
  }

  return concerns;
}

function buildAlternatives(context: SingleCandidateDecisionContext): DecisionAlternative[] {
  const { candidate, preferences, portfolio, opportunityScore } = context;
  const alternatives: DecisionAlternative[] = [];
  const baseScore = opportunityScore.total;

  if (candidate.strategy === 'CSP') {
    alternatives.push({
      action: 'OPEN_BPS',
      strategy: 'BPS',
      score: clamp(baseScore - (preferences.preferDefinedRisk ? 2 : 12)),
      disposition: preferences.preferDefinedRisk ? 'considered' : 'rejected',
      reasons: preferences.preferDefinedRisk
        ? ['Provides defined risk and consumes less buying power.']
        : ['Available capital and ownership intent favor the cash-secured put.'],
    });

    alternatives.push({
      action: 'BUY_SHARES',
      score: clamp(baseScore - 8),
      disposition: portfolio.availableBuyingPower >= candidate.underlyingPrice * 100 ? 'considered' : 'not_available',
      reasons:
        portfolio.availableBuyingPower >= candidate.underlyingPrice * 100
          ? ['Provides direct upside but forgoes option premium and downside buffer.']
          : ['Insufficient buying power for 100 shares.'],
    });
  }

  if (candidate.strategy === 'BPS') {
    alternatives.push({
      action: 'SELL_CSP',
      strategy: 'CSP',
      score: clamp(baseScore - (preferences.willingToOwn ? 3 : 20)),
      disposition: preferences.willingToOwn ? 'considered' : 'not_available',
      reasons: preferences.willingToOwn
        ? ['Potentially better ownership alignment, but requires materially more capital.']
        : ['Trader is unwilling to own the underlying shares.'],
    });
  }

  alternatives.push({
    action: 'WAIT',
    score: clamp(100 - baseScore),
    disposition: baseScore < 60 ? 'considered' : 'rejected',
    reasons:
      baseScore < 60
        ? ['Current opportunity quality may not justify deploying capital.']
        : ['Current opportunity score exceeds the wait threshold.'],
  });

  return alternatives.sort((a, b) => b.score - a.score);
}

function buildReviewTriggers(context: SingleCandidateDecisionContext): DecisionReviewTrigger[] {
  const triggers: DecisionReviewTrigger[] = [
    {
      id: 'profit-target',
      label: 'Profit target reached',
      triggerType: 'profit_target',
      threshold: '50%',
      explanation: 'Review for closing when approximately half of the maximum premium has been captured.',
    },
    {
      id: 'dte',
      label: 'Time-based review',
      triggerType: 'dte',
      threshold: 21,
      explanation: 'Re-evaluate at 21 DTE unless the strategy is intentionally assignment-oriented.',
    },
    {
      id: 'earnings-change',
      label: 'Earnings date changes',
      triggerType: 'earnings',
      explanation: 'Re-evaluate if an earnings event moves inside the option lifecycle.',
    },
    {
      id: 'risk-limit',
      label: 'Portfolio risk limit changes',
      triggerType: 'risk',
      explanation: 'Re-evaluate if concentration, drawdown, or buying-power limits materially change.',
    },
  ];

  if (context.candidate.strategy === 'CSP') {
    triggers.push({
      id: 'support-break',
      label: 'Underlying breaks technical support',
      triggerType: 'price',
      explanation: 'Reassess whether assignment remains desirable if support fails.',
    });
  }

  return triggers;
}

function describeConcern(concern: DecisionConcern): string {
  return `${concern.label.toLowerCase()} (${concern.explanation})`;
}

// Summarizes the strongest alternative Autopilot actually weighed, so
// rationale can address "why not the alternatives" without duplicating the
// reasoning already captured in buildAlternatives() -- this just narrates it.
function topAlternativeSummary(alternatives: DecisionAlternative[]): string | undefined {
  const candidate = alternatives.find((alt) => alt.disposition !== 'not_available');
  if (!candidate) return undefined;
  const label = candidate.action.replaceAll('_', ' ').toLowerCase();
  const reason = (candidate.reasons[0] ?? 'no stated advantage over this trade').toLowerCase().replace(/\.$/, '');
  return `The next-best alternative, ${label}, was ${candidate.disposition} because ${reason}`;
}

function buildRationale(args: {
  action: DecisionAction;
  status: DecisionAnalysis['recommendation']['status'];
  candidate: SingleCandidateDecisionContext['candidate'];
  concerns: DecisionConcern[];
  alternatives: DecisionAlternative[];
  confidence: number;
  minimumConfidence: number;
  marketBias: SingleCandidateDecisionContext['market']['bias'];
  opportunityTotal: number;
}): string {
  const { action, status, candidate, concerns, alternatives, confidence, minimumConfidence, marketBias, opportunityTotal } = args;
  const altSummary = topAlternativeSummary(alternatives);
  const actionLabel = action.replaceAll('_', ' ');

  if (status === 'not_recommended') {
    const blocking = concerns.filter((c) => c.severity === 'critical');
    const lead = blocking.length
      ? `${actionLabel} ${candidate.symbol}: blocked because ${blocking.map(describeConcern).join('; and ')}.`
      : `${actionLabel} ${candidate.symbol}: not recommended today.`;
    const altText = altSummary ? ` ${altSummary}.` : '';
    return `${lead}${altText} This holds regardless of opportunity score (${opportunityTotal.toFixed(0)}) -- no sizing or timing adjustment resolves it, so wait for the underlying condition to change.`;
  }

  if (status === 'conditional') {
    const highs = concerns.filter((c) => c.severity === 'high');
    const reasons: string[] = [];
    if (confidence < minimumConfidence) {
      reasons.push(`decision confidence is ${confidence.toFixed(0)}, below the ${minimumConfidence.toFixed(0)} minimum required`);
    }
    if (marketBias === 'uncertain') {
      reasons.push('the underlying market bias is uncertain rather than clearly bullish or bearish');
    }
    if (highs.length) {
      reasons.push(highs.map(describeConcern).join('; and '));
    }
    const reasonText = reasons.length ? reasons.join('; and ') : 'current conditions are not strong enough to clear the bar';
    const altText = altSummary ? `, and ${altSummary.toLowerCase()}` : '';
    return `Wait on ${candidate.strategy} ${candidate.symbol} for now: ${reasonText}. The setup itself (opportunity score ${opportunityTotal.toFixed(0)}) may still be reasonable${altText} -- revisit once the blocking condition above resolves.`;
  }

  // recommended
  const positives = concerns.length === 0
    ? 'no concerns of any severity were found'
    : 'only low-severity concerns were found, none of which block the trade';
  const altText = altSummary ? ` ${altSummary}, so this remains the strongest option today.` : '';
  return `${actionLabel} ${candidate.symbol} clears the current checks: confidence is ${confidence.toFixed(0)} (at or above the ${minimumConfidence.toFixed(0)} minimum) and opportunity score is ${opportunityTotal.toFixed(0)}, and ${positives}.${altText}`;
}

export function evaluateSingleCandidate(
  context: SingleCandidateDecisionContext,
): DecisionAnalysis {
  const { candidate, confidenceInput, opportunityScore, preferences, market } = context;
  const concerns = buildConcerns(context);
  const alternatives = buildAlternatives(context);
  const criticalConcern = concerns.some((concern) => concern.severity === 'critical');
  const highConcern = concerns.some((concern) => concern.severity === 'high');
  const confidence = clamp(confidenceInput.framework.total);
  const belowThreshold = confidence < preferences.minimumConfidence;

  let action = actionForStrategy(candidate.strategy);
  let status: DecisionAnalysis['recommendation']['status'] = 'recommended';
  let summary = `${action.replaceAll('_', ' ')} on ${candidate.symbol}.`;

  if (criticalConcern) {
    action = 'AVOID';
    status = 'not_recommended';
    summary = `Avoid the proposed ${candidate.strategy} on ${candidate.symbol}.`;
  } else if (highConcern || belowThreshold || market.bias === 'uncertain') {
    action = 'WAIT';
    status = 'conditional';
    summary = `Wait before opening the proposed ${candidate.strategy} on ${candidate.symbol}.`;
  }

  const overallConfidence = clamp(
    confidence * 0.55 + opportunityScore.total * 0.25 + (criticalConcern ? 0 : highConcern ? 10 : 20),
  );

  return {
    id: createId('decision'),
    createdAt: new Date().toISOString(),
    version: 'decision-analysis-v1',
    subject: {
      type: 'candidate',
      id: candidate.id,
      symbol: candidate.symbol,
      strategy: candidate.strategy,
      label: `${candidate.symbol} ${candidate.strategy} candidate`,
    },
    objective: context.objective,
    recommendation: {
      action,
      strategy: action === 'WAIT' || action === 'AVOID' ? undefined : candidate.strategy,
      summary,
      status,
    },
    confidence: {
      overall: overallConfidence,
      market: clamp(market.bias === 'uncertain' ? 45 : market.macroRiskElevated ? 60 : 85),
      portfolio: clamp(criticalConcern ? 35 : highConcern ? 55 : 85),
      execution: confidenceInput.framework.liquidityScore + confidenceInput.framework.latencyScore,
      income: clamp(opportunityScore.edgeScore),
      risk: clamp(100 - opportunityScore.riskContributionPenalty),
      framework: confidenceInput.framework,
    },
    priority: criticalConcern ? 'high' : status === 'recommended' ? 'normal' : 'low',
    rationale: buildRationale({
      action,
      status,
      candidate,
      concerns,
      alternatives,
      confidence,
      minimumConfidence: preferences.minimumConfidence,
      marketBias: market.bias,
      opportunityTotal: opportunityScore.total,
    }),
    supportingEvidence: buildEvidence(context),
    concerns,
    alternatives,
    reviewTriggers: buildReviewTriggers(context),
    expectedOutcome: {
      intent: context.objective,
      expectedCredit: candidate.estimatedCredit,
      capitalRequired: candidate.theoreticalMaxLoss,
      theoreticalMaxLoss: candidate.theoreticalMaxLoss,
      assignmentProbabilityPct:
        candidate.strategy === 'CSP' ? inferAssignmentProbability(candidate.pop) : undefined,
    },
    opportunityScore,
    candidate,
    metadata: {
      source: context.source ?? 'manual',
      executionAllowed: false,
      paperExecutionAllowed: false,
      rulesEvaluated: [
        'decision_confidence_minimum',
        'buying_power',
        'single_ticker_concentration',
        'sector_concentration',
        'earnings_gate',
        'macro_risk',
        'volatility_stability',
        'ownership_intent',
        'defined_risk_preference',
      ],
      rulesBlocked: concerns
        .filter((concern) => concern.severity === 'critical' || concern.severity === 'high')
        .map((concern) => concern.id),
    },
  };
}
