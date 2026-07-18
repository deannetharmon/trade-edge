// lib/opportunity-engine/__tests__/decisionAnalysisFixture.ts
//
// OE-0001 test helper -- NOT a test file itself. Builds a complete, valid
// DecisionAnalysis (the existing, real Decision Engine output shape) with
// sensible defaults, so opportunity-engine tests exercise the real
// production contract rather than a hand-rolled stand-in. Every field
// matches lib/decision-engine/types.ts exactly; overrides let each test
// vary only what that scenario cares about.

import type { AutopilotCandidate, AutopilotStrategy } from '@/lib/autopilot/types';
import type { DecisionAnalysis, DecisionConcern, DecisionEvidence } from '@/lib/decision-engine';
import { decisionAnalysisToOpportunityCandidate } from '../adapters/decisionAnalysisAdapter';
import type { OpportunityCandidate } from '../types';

let sequence = 0;
function nextId(prefix: string): string {
  sequence += 1;
  return `${prefix}_fixture_${sequence}`;
}

export function buildCandidateFixture(overrides: Partial<AutopilotCandidate> = {}): AutopilotCandidate {
  return {
    id: nextId('cand'),
    strategy: 'BPS',
    symbol: 'AAPL',
    underlyingPrice: 190,
    legs: [
      {
        symbol: 'AAPL240119P00185000',
        underlyingSymbol: 'AAPL',
        assetType: 'option',
        direction: 'short',
        optionType: 'put',
        strike: 185,
        expiration: '2026-08-21',
        quantity: 1,
        bid: 1.2,
        ask: 1.3,
        mid: 1.25,
      },
      {
        symbol: 'AAPL240119P00180000',
        underlyingSymbol: 'AAPL',
        assetType: 'option',
        direction: 'long',
        optionType: 'put',
        strike: 180,
        expiration: '2026-08-21',
        quantity: 1,
        bid: 0.6,
        ask: 0.7,
        mid: 0.65,
      },
    ],
    estimatedCredit: 60,
    theoreticalMaxLoss: 440,
    pop: 72,
    roc: 13.6,
    ivr: 45,
    ...overrides,
  };
}

export interface DecisionAnalysisFixtureOverrides {
  status?: DecisionAnalysis['recommendation']['status'];
  opportunityScoreTotal?: number;
  confidenceOverall?: number;
  concerns?: DecisionConcern[];
  supportingEvidence?: DecisionEvidence[];
  source?: DecisionAnalysis['metadata']['source'];
  candidate?: AutopilotCandidate;
  capitalRequired?: number;
  symbol?: string;
  strategy?: AutopilotStrategy;
  id?: string;
}

export function buildDecisionAnalysisFixture(overrides: DecisionAnalysisFixtureOverrides = {}): DecisionAnalysis {
  const status = overrides.status ?? 'recommended';
  // Only pass through keys that were actually supplied -- an explicit
  // `key: undefined` in an object literal still overwrites
  // buildCandidateFixture's defaults during spread, so omitting the key
  // entirely (rather than passing it as undefined) is required here.
  const candidate = overrides.candidate ?? buildCandidateFixture({
    ...(overrides.symbol !== undefined ? { symbol: overrides.symbol } : {}),
    ...(overrides.strategy !== undefined ? { strategy: overrides.strategy } : {}),
    ...(overrides.capitalRequired !== undefined ? { theoreticalMaxLoss: overrides.capitalRequired } : {}),
  });
  const opportunityScoreTotal = overrides.opportunityScoreTotal ?? 65;
  const confidenceOverall = overrides.confidenceOverall ?? 75;
  const concerns = overrides.concerns ?? [];
  const supportingEvidence = overrides.supportingEvidence ?? [
    { id: 'pop', label: 'Probability of profit', value: '72%', tone: 'positive' },
  ];

  const action = status === 'not_recommended' ? 'AVOID' : status === 'conditional' ? 'WAIT' : 'OPEN_BPS';

  return {
    id: overrides.id ?? nextId('decision'),
    createdAt: new Date('2026-07-20T14:00:00.000Z').toISOString(),
    version: 'decision-analysis-v1',
    subject: {
      type: 'candidate',
      id: candidate.id,
      symbol: candidate.symbol,
      strategy: candidate.strategy,
      label: `${candidate.symbol} ${candidate.strategy} candidate`,
    },
    objective: 'deploy_idle_cash',
    recommendation: {
      action,
      strategy: action === 'WAIT' || action === 'AVOID' ? undefined : candidate.strategy,
      summary: `${action} on ${candidate.symbol}.`,
      status,
    },
    confidence: {
      overall: confidenceOverall,
      market: 80,
      portfolio: 80,
      execution: 36,
      income: 60,
      risk: 80,
    },
    priority: status === 'not_recommended' ? 'high' : 'normal',
    rationale: `${action} ${candidate.symbol}: fixture rationale for status "${status}".`,
    supportingEvidence,
    concerns,
    alternatives: [],
    reviewTriggers: [],
    expectedOutcome: {
      intent: 'deploy_idle_cash',
      expectedCredit: candidate.estimatedCredit,
      capitalRequired: overrides.capitalRequired ?? candidate.theoreticalMaxLoss,
      theoreticalMaxLoss: candidate.theoreticalMaxLoss,
    },
    opportunityScore: {
      total: opportunityScoreTotal,
      edgeScore: opportunityScoreTotal,
      goalAlignmentFactor: 1,
      riskContributionPenalty: 0,
      postureMultiplier: 1,
      notes: [],
    },
    candidate,
    metadata: {
      source: overrides.source ?? 'screener',
      executionAllowed: false,
      paperExecutionAllowed: false,
      rulesEvaluated: ['decision_confidence_minimum', 'buying_power'],
      rulesBlocked: concerns.filter((c) => c.severity === 'critical' || c.severity === 'high').map((c) => c.id),
    },
  };
}

// Builds an OpportunityCandidate via the real adapter (never hand-rolled),
// so every opportunity-engine test exercises the actual production
// conversion path, not a shortcut around it.
export function buildOpportunityCandidateFixture(
  overrides: DecisionAnalysisFixtureOverrides & { candidateOverrides?: Partial<OpportunityCandidate> } = {},
): OpportunityCandidate {
  const { candidateOverrides, ...analysisOverrides } = overrides;
  const analysis = buildDecisionAnalysisFixture(analysisOverrides);
  const candidate = decisionAnalysisToOpportunityCandidate(analysis);
  if (!candidate) throw new Error('Fixture analysis must always produce a candidate.');
  return { ...candidate, ...candidateOverrides };
}
