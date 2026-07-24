// lib/command-center/__tests__/screenerOpportunityRecommendations.test.ts
//
// OE-0002A: coverage for the new Screener wiring's pure translation layer --
// the only new logic this sprint adds. Confirms the existing, unmodified
// /api/autopilot/recommendations response shape reaches the existing,
// unmodified OE-0001 adapter + ranker (via buildOpportunityRecommendations)
// correctly; that a missing/empty feed produces an honest empty result,
// never a fabricated one; and that the existing deterministic ranking order
// is preserved end to end. Does not re-test buildOpportunityRecommendations,
// the OE-0001 adapter, or the OE-0001 ranker themselves -- those already have
// their own passing test suites, unchanged by this sprint.

import { describe, expect, it } from 'vitest';
import { opportunityRecommendationsFromApiResponse } from '../screenerOpportunityRecommendations';
import { buildOpportunityRecommendations } from '../buildOpportunityRecommendations';
import { buildDecisionAnalysisFixture } from '@/lib/opportunity-engine/__tests__/decisionAnalysisFixture';

const NOW = new Date('2026-07-24T15:00:00.000Z');

describe('OE-0002A: opportunityRecommendationsFromApiResponse', () => {
  it('produces an honest empty result when the response has no result.recommendations -- never fabricated', () => {
    const result = opportunityRecommendationsFromApiResponse({ success: true }, NOW);

    expect(result.recommendations).toEqual([]);
    expect(result.generatedAt).toBe(NOW.toISOString());
  });

  it('produces an honest empty result for an explicitly empty recommendations array', () => {
    const result = opportunityRecommendationsFromApiResponse({ result: { recommendations: [] } }, NOW);

    expect(result.recommendations).toEqual([]);
  });

  it('passes a real DecisionAnalysis[] through to the existing adapter + ranker unchanged', () => {
    const analyses = [
      buildDecisionAnalysisFixture({ symbol: 'AAPL', opportunityScoreTotal: 70 }),
      buildDecisionAnalysisFixture({ symbol: 'SPY', opportunityScoreTotal: 85 }),
    ];

    const viaWiring = opportunityRecommendationsFromApiResponse({ result: { recommendations: analyses } }, NOW);
    const direct = buildOpportunityRecommendations(analyses, { availableCapital: 0, generatedAt: NOW.toISOString() });

    expect(viaWiring.recommendations).toEqual(direct.recommendations);
  });

  it('preserves the existing deterministic ranking order (higher opportunity score displays first)', () => {
    const analyses = [
      buildDecisionAnalysisFixture({ symbol: 'LOW', opportunityScoreTotal: 40 }),
      buildDecisionAnalysisFixture({ symbol: 'HIGH', opportunityScoreTotal: 95 }),
    ];

    const { recommendations } = opportunityRecommendationsFromApiResponse({ result: { recommendations: analyses } }, NOW);

    expect(recommendations[0].symbol).toBe('HIGH');
    expect(recommendations[1].symbol).toBe('LOW');
  });

  it('is portfolio-neutral -- always calls the ranker with availableCapital: 0, no exposure fields', () => {
    // A candidate requiring any positive capital cannot be RECOMMENDED
    // against a zero-capital context (see evaluateOpportunityCandidate's
    // insufficient-total-capital branch) -- this is the existing ranker's
    // own behavior, unmodified, and confirms OE-0002A's wiring never
    // supplies live capital/exposure data.
    const analyses = [buildDecisionAnalysisFixture({ symbol: 'AAPL', capitalRequired: 440 })];

    const { recommendations } = opportunityRecommendationsFromApiResponse({ result: { recommendations: analyses } }, NOW);

    expect(recommendations[0].disposition).not.toBe('RECOMMENDED');
  });
});
