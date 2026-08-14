// lib/command-center/__tests__/opportunityCandidateDetails.test.ts
//
// WA-0005 §13/§22: unit tests for the additive, presentation-only
// DecisionAnalysis[] -> decisionAnalysisId-keyed detail index projection.
// Confirms: correct id-keyed projection, correct handling of a missing
// `candidate`/individual optional fields (never fabricating values), and no
// mutation of the input DecisionAnalysis[].

import { describe, expect, it } from 'vitest';
import {
  buildOpportunityCandidateDetail,
  buildOpportunityCandidateDetails,
} from '../opportunityCandidateDetails';
import type { DecisionAnalysis } from '@/lib/decision-engine';

const FIXED_NOW = new Date('2026-07-25T12:00:00.000Z');

function makeAnalysis(overrides: Partial<DecisionAnalysis> = {}): DecisionAnalysis {
  return {
    id: 'decision_1',
    createdAt: '2026-07-25T00:00:00.000Z',
    version: 'decision-analysis-v1',
    subject: { type: 'candidate', id: 'cand_1', symbol: 'AAPL', strategy: 'BPS', label: 'AAPL BPS' },
    objective: 'generate_income',
    recommendation: { action: 'OPEN_BPS', strategy: 'BPS', summary: 'Open it.', status: 'recommended' },
    confidence: { overall: 80, market: 80, portfolio: 80, execution: 80, income: 80, risk: 80 },
    priority: 'normal',
    rationale: 'Good setup.',
    supportingEvidence: [],
    concerns: [],
    alternatives: [],
    reviewTriggers: [],
    expectedOutcome: { intent: 'income' },
    candidate: undefined,
    metadata: {
      source: 'screener',
      executionAllowed: false,
      paperExecutionAllowed: false,
      rulesEvaluated: [],
      rulesBlocked: [],
    },
    ...overrides,
  };
}

describe('buildOpportunityCandidateDetail', () => {
  it('keys the detail by the DecisionAnalysis id (matches OpportunityRecommendation.decisionAnalysisId)', () => {
    const analysis = makeAnalysis({ id: 'decision_xyz' });
    const detail = buildOpportunityCandidateDetail(analysis, FIXED_NOW);
    expect(detail.decisionAnalysisId).toBe('decision_xyz');
  });

  it('leaves every candidate-shape field undefined (never fabricated) when candidate is absent', () => {
    const analysis = makeAnalysis({ candidate: undefined });
    const detail = buildOpportunityCandidateDetail(analysis, FIXED_NOW);

    expect(detail.underlyingPrice).toBeUndefined();
    expect(detail.legs).toBeUndefined();
    expect(detail.expiration).toBeUndefined();
    expect(detail.dte).toBeUndefined();
    expect(detail.roc).toBeUndefined();
    expect(detail.annualizedYield).toBeUndefined();
    expect(detail.pop).toBeUndefined();
    expect(detail.betaWeightedDelta).toBeUndefined();
    expect(detail.ivr).toBeUndefined();
    expect(detail.earningsDate).toBeUndefined();
  });

  it('carries through guaranteed, non-optional DecisionAnalysis fields even when empty', () => {
    const analysis = makeAnalysis();
    const detail = buildOpportunityCandidateDetail(analysis, FIXED_NOW);

    expect(detail.alternatives).toEqual([]);
    expect(detail.reviewTriggers).toEqual([]);
    expect(detail.concerns).toEqual([]);
    expect(detail.rulesEvaluated).toEqual([]);
    expect(detail.rulesBlocked).toEqual([]);
    expect(detail.expectedOutcome).toEqual({ intent: 'income' });
  });

  it('populates candidate-shape fields when candidate is present, deriving DTE from the latest leg expiration', () => {
    const analysis = makeAnalysis({
      candidate: {
        id: 'cand_1',
        strategy: 'BPS',
        symbol: 'AAPL',
        underlyingPrice: 190.5,
        legs: [
          { symbol: 'AAPL', underlyingSymbol: 'AAPL', assetType: 'option', direction: 'short', optionType: 'put', strike: 180, expiration: '2026-08-21', quantity: 1 },
          { symbol: 'AAPL', underlyingSymbol: 'AAPL', assetType: 'option', direction: 'long', optionType: 'put', strike: 175, expiration: '2026-08-21', quantity: 1 },
        ],
        estimatedCredit: 1.2,
        theoreticalMaxLoss: 380,
        pop: 78,
        roc: 24,
        ivr: 45,
        annualizedYield: 33,
        betaWeightedDelta: -0.12,
        earningsDate: '2026-08-01',
      },
    });
    const detail = buildOpportunityCandidateDetail(analysis, FIXED_NOW);

    expect(detail.underlyingPrice).toBe(190.5);
    expect(detail.legs).toHaveLength(2);
    expect(detail.expiration).toBe('2026-08-21');
    expect(detail.dte).toBe(Math.round((new Date('2026-08-21').getTime() - FIXED_NOW.getTime()) / 86_400_000));
    expect(detail.credit).toBe(1.2);
    expect(detail.capitalRequirement).toBe(380);
    expect(detail.roc).toBe(24);
    expect(detail.pop).toBe(78);
    expect(detail.ivr).toBe(45);
    expect(detail.annualizedYield).toBe(33);
    expect(detail.betaWeightedDelta).toBe(-0.12);
    expect(detail.earningsDate).toBe('2026-08-01');
  });

  it('prefers expectedOutcome.capitalRequired over candidate.theoreticalMaxLoss when both are present', () => {
    const analysis = makeAnalysis({
      expectedOutcome: { intent: 'income', capitalRequired: 500 },
      candidate: {
        id: 'cand_1', strategy: 'BPS', symbol: 'AAPL', underlyingPrice: 100, legs: [],
        estimatedCredit: 1, theoreticalMaxLoss: 999,
      },
    });
    const detail = buildOpportunityCandidateDetail(analysis, FIXED_NOW);
    expect(detail.capitalRequirement).toBe(500);
  });

  it('preserves both PMCC expirations and consumes canonical capital without recalculation', () => {
    const analysis = makeAnalysis({
      subject: { type: 'candidate', id: 'pmcc', symbol: 'AAPL', strategy: 'PMCC', label: 'AAPL PMCC' },
      recommendation: { action: 'OPEN_PMCC', strategy: 'PMCC', summary: 'Review PMCC.', status: 'conditional' },
      expectedOutcome: { intent: 'income', capitalRequired: 3_000 },
      candidate: {
        id: 'pmcc',
        strategy: 'PMCC',
        symbol: 'AAPL',
        underlyingPrice: 190,
        legs: [
          {
            symbol: 'AAPL270115C00150000', optionSymbol: 'AAPL270115C00150000',
            underlyingSymbol: 'AAPL', assetType: 'option', direction: 'long', optionType: 'call',
            strike: 150, expiration: '2027-01-15', quantity: 1, contractMultiplier: 100, openInterest: 1_200,
          },
          {
            symbol: 'AAPL260918C00205000', optionSymbol: 'AAPL260918C00205000',
            underlyingSymbol: 'AAPL', assetType: 'option', direction: 'short', optionType: 'call',
            strike: 205, expiration: '2026-09-18', quantity: 1, contractMultiplier: 100, openInterest: 900,
          },
        ],
        estimatedCredit: 135,
        theoreticalMaxLoss: 3_000,
        netDebit: 30,
        netDebitUnit: 'per_share',
        sourceResultId: 'AAPL::PMCC',
      },
    });
    const detail = buildOpportunityCandidateDetail(analysis, FIXED_NOW);
    expect(detail.capitalRequirement).toBe(3_000);
    expect(detail.netDebit).toBe(30);
    expect(detail.netDebitUnit).toBe('per_share');
    expect(detail.expiration).toBe('2027-01-15');
    expect(detail.legs?.map((leg) => leg.expiration)).toEqual(['2027-01-15', '2026-09-18']);
    expect(detail.legs?.map((leg) => leg.openInterest)).toEqual([1_200, 900]);
  });

  it('does not mutate the input DecisionAnalysis', () => {
    const analysis = makeAnalysis({
      candidate: {
        id: 'cand_1', strategy: 'BPS', symbol: 'AAPL', underlyingPrice: 100,
        legs: [{ symbol: 'AAPL', underlyingSymbol: 'AAPL', assetType: 'option', direction: 'short', expiration: '2026-08-21', quantity: 1 }],
        estimatedCredit: 1, theoreticalMaxLoss: 100,
      },
    });
    const snapshot = JSON.parse(JSON.stringify(analysis));
    buildOpportunityCandidateDetail(analysis, FIXED_NOW);
    expect(analysis).toEqual(snapshot);
  });
});

describe('buildOpportunityCandidateDetails', () => {
  it('projects a full DecisionAnalysis[] into a decisionAnalysisId-keyed index', () => {
    const analyses = [makeAnalysis({ id: 'a1' }), makeAnalysis({ id: 'a2' })];
    const index = buildOpportunityCandidateDetails(analyses, FIXED_NOW);

    expect(Object.keys(index).sort()).toEqual(['a1', 'a2']);
    expect(index.a1.decisionAnalysisId).toBe('a1');
    expect(index.a2.decisionAnalysisId).toBe('a2');
  });

  it('returns an empty index for an empty input array, never fabricating an entry', () => {
    expect(buildOpportunityCandidateDetails([], FIXED_NOW)).toEqual({});
  });

  it('does not mutate the input array', () => {
    const analyses = [makeAnalysis({ id: 'a1' })];
    const snapshot = JSON.parse(JSON.stringify(analyses));
    buildOpportunityCandidateDetails(analyses, FIXED_NOW);
    expect(analyses).toEqual(snapshot);
  });
});
