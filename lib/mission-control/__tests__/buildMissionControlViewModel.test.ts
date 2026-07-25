// lib/mission-control/__tests__/buildMissionControlViewModel.test.ts
//
// MB-0002: coverage for the view-model layer that wires /dashboard's
// already-loaded DashboardComposition into a ReviewNarrative. This does not
// re-test buildAttentionFeed or conductReview themselves -- those have their
// own full suites, unchanged by this sprint -- it verifies state
// classification (loading/unavailable/error/loaded) and that this module
// passes data through without inventing, dropping, or rescoring anything.

import { describe, expect, it } from 'vitest';
import { buildMissionControlViewModel } from '../buildMissionControlViewModel';
import type { BuildMissionControlViewModelInput } from '../types';
import type { DashboardComposition } from '@/lib/portfolio-intelligence/dashboardComposition';
import type { OpportunityRecommendation } from '@/lib/opportunity-engine';

const FIXED_NOW = new Date('2026-07-25T09:00:00.000Z');

const EMPTY_DASHBOARD = {
  immediateAction: [],
  reviewToday: { mediumPriority: [], earningsReviews: [], expiringPositions: [], needsFollowUp: [] },
  monitor: [],
  opportunities: { rollOpportunities: [], coveredCallOpportunities: [], cspOpportunities: [], screenerCandidatesAvailable: false },
} as any;

function unavailableComposition(): DashboardComposition {
  return {
    canonicalPriorities: null,
    todaysPrioritiesDashboard: EMPTY_DASHBOARD,
    topPriority: null,
    averagePositionHealth: null,
    portfolioHealth: { score: 0, status: 'Healthy', positiveContributors: [], negativeContributors: [] } as any,
    portfolioReview: null,
    dailyBriefing: null,
  };
}

function loadedComposition(): DashboardComposition {
  return {
    canonicalPriorities: null,
    todaysPrioritiesDashboard: EMPTY_DASHBOARD,
    topPriority: null,
    averagePositionHealth: null,
    portfolioHealth: { score: 91, status: 'Healthy', positiveContributors: [], negativeContributors: [] } as any,
    portfolioReview: {
      generatedAt: FIXED_NOW.toISOString(),
      currentState: {
        health: { score: 91, status: 'Healthy', positiveContributors: [], negativeContributors: [] },
        topRisks: [],
        concentrationConcerns: [],
        capitalConcerns: [],
        incomeConcern: null,
      },
      composition: {
        positionCount: 3,
        byStrategy: { BPS: 3 },
        symbolConcentrationPct: {},
        maxSymbolConcentrationPct: null,
        wheelManagedFraction: null,
      },
    } as any,
    dailyBriefing: null,
  };
}

function baseInput(overrides: Partial<BuildMissionControlViewModelInput> = {}): BuildMissionControlViewModelInput {
  return {
    composition: unavailableComposition(),
    compositionLoading: false,
    opportunityRecommendations: [],
    now: FIXED_NOW,
    ...overrides,
  };
}

describe('buildMissionControlViewModel: error state', () => {
  it('reports error state with the given message and no narrative, regardless of composition', () => {
    const result = buildMissionControlViewModel(baseInput({ composition: loadedComposition(), compositionError: 'boom' }));

    expect(result.state).toBe('error');
    expect(result.message).toBe('boom');
    expect(result.narrative).toBeNull();
  });
});

describe('buildMissionControlViewModel: no portfolio review yet', () => {
  it('reports loading state while composition is still loading', () => {
    const result = buildMissionControlViewModel(baseInput({ compositionLoading: true }));

    expect(result.state).toBe('loading');
    expect(result.narrative).toBeNull();
  });

  it('reports unavailable state with an honest message once loading has finished and nothing loaded', () => {
    const result = buildMissionControlViewModel(baseInput({ compositionLoading: false }));

    expect(result.state).toBe('unavailable');
    expect(result.message).toMatch(/open Portfolio/);
    expect(result.narrative).toBeNull();
  });
});

describe('buildMissionControlViewModel: loaded state', () => {
  it('builds a real ReviewNarrative once a PortfolioReviewSnapshot exists, passing portfolioReview through by reference', () => {
    const composition = loadedComposition();
    const result = buildMissionControlViewModel(baseInput({ composition }));

    expect(result.state).toBe('loaded');
    expect(result.narrative).not.toBeNull();
    expect(result.narrative!.portfolioStatus.review).toBe(composition.portfolioReview);
  });

  it('passes opportunityRecommendations through by reference as New Opportunities, defaulting to an empty array when null', () => {
    const opportunities = [{ candidateId: 'c1' } as OpportunityRecommendation];
    const withOpportunities = buildMissionControlViewModel(
      baseInput({ composition: loadedComposition(), opportunityRecommendations: opportunities }),
    );
    expect(withOpportunities.narrative!.newOpportunities.items).toBe(opportunities);

    const withNull = buildMissionControlViewModel(baseInput({ composition: loadedComposition(), opportunityRecommendations: null }));
    expect(withNull.narrative!.newOpportunities.items).toEqual([]);
  });

  it('always passes an empty revalidationResults array -- no Trader Commitment persistence exists on this page this sprint', () => {
    const result = buildMissionControlViewModel(baseInput({ composition: loadedComposition() }));

    expect(result.narrative!.sinceLastReview.changes).toEqual([]);
  });

  it('derives the attention feed from the composition’s own TodaysPrioritiesDashboard, not a re-fetched or re-scored copy', () => {
    const composition = loadedComposition();
    const result = buildMissionControlViewModel(baseInput({ composition }));

    // An empty dashboard produces an empty, but real, ordered feed -- not a
    // fabricated "no attention items" shortcut.
    expect(result.narrative!.attention.items).toEqual([]);
    expect(result.narrative!.leadItem).toBeNull();
    expect(result.narrative!.complete.isComplete).toBe(true);
  });

  it('stamps generatedAt and lastRefreshedAt from the given now/lastRefreshedAt inputs', () => {
    const result = buildMissionControlViewModel(
      baseInput({ composition: loadedComposition(), lastRefreshedAt: '2026-07-24T08:00:00.000Z' }),
    );

    expect(result.generatedAt).toBe(FIXED_NOW.toISOString());
    expect(result.lastRefreshedAt).toBe('2026-07-24T08:00:00.000Z');
  });
});

describe('buildMissionControlViewModel: determinism', () => {
  it('produces deeply equal results across repeated calls with identical input', () => {
    const input = baseInput({ composition: loadedComposition() });

    const first = buildMissionControlViewModel(input);
    const second = buildMissionControlViewModel(input);

    expect(second).toEqual(first);
  });
});
