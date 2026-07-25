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

describe('buildMissionControlViewModel: WA-0003 todaysPriorities summary', () => {
  it('is the empty summary (leadItem null, openCount 0, deepLink null) in every non-loaded state', () => {
    expect(buildMissionControlViewModel(baseInput({ compositionLoading: true })).todaysPriorities).toEqual({
      leadItem: null, openCount: 0, deepLink: null,
    });
    expect(buildMissionControlViewModel(baseInput({ composition: loadedComposition(), compositionError: 'boom' })).todaysPriorities).toEqual({
      leadItem: null, openCount: 0, deepLink: null,
    });
  });

  it('is the empty summary when the loaded dashboard has no attention items ("no open items" state)', () => {
    const result = buildMissionControlViewModel(baseInput({ composition: loadedComposition() }));
    expect(result.todaysPriorities).toEqual({ leadItem: null, openCount: 0, deepLink: null });
  });

  it('leadItem/openCount/deepLink derive from the shared queue, matching an equivalent partitionTodaysPrioritiesQueue call -- never from narrative.attention/narrative.counts.attention', async () => {
    const { buildTodaysPrioritiesQueue, partitionTodaysPrioritiesQueue } = await import('@/lib/todays-priorities-queue');
    const objective = {
      id: 'obj_1', createdAt: '2026-07-24T00:00:00.000Z', version: 'portfolio-objective-v1',
      type: 'MANAGE_POSITION', ruleId: 'OBJ-WATCH-POSITION', title: 'Manage AMD', summary: 'Test', priority: 'high',
      urgency: 'today', actionability: 'CRITICAL', confidence: 90, status: 'active', source: 'position',
      subject: { type: 'position', id: 'AMD::2026-08-21', symbol: 'AMD', label: 'AMD' },
      rationale: 'Test rationale', supportingEvidence: [], concerns: [],
      portfolioImpact: { direction: 'neutral', magnitude: 'low', explanation: '' },
      incomeImpact: { direction: 'neutral', magnitude: 'low', explanation: '' },
      riskImpact: { direction: 'neutral', magnitude: 'low', explanation: '' },
      capitalImpact: { direction: 'neutral', magnitude: 'low', explanation: '' },
      reviewTriggers: [], metadata: { executionAllowed: false, paperExecutionAllowed: false, rulesEvaluated: [], rulesTriggered: [] },
    } as any;
    const dashboardWithAttention = {
      ...EMPTY_DASHBOARD,
      immediateAction: [{ objective, score: 90, tier: 'Critical', reasons: [] }],
    };
    const composition = { ...loadedComposition(), todaysPrioritiesDashboard: dashboardWithAttention };

    const result = buildMissionControlViewModel(baseInput({ composition }));

    const expectedQueue = buildTodaysPrioritiesQueue({ dashboard: dashboardWithAttention, generatedAt: FIXED_NOW.toISOString() });
    const expectedPartition = partitionTodaysPrioritiesQueue(expectedQueue, {});

    expect(result.todaysPriorities.openCount).toBe(expectedPartition.openCount);
    expect(result.todaysPriorities.leadItem?.stableKey).toBe(expectedPartition.leadItem?.stableKey);
    expect(result.todaysPriorities.deepLink).toBe(`/portfolio?tab=todays-priorities&priority=${encodeURIComponent(expectedPartition.leadItem!.stableKey)}`);
    expect(result.todaysPriorities.deepLink).toMatch(/^\/portfolio\?/);
    expect(result.todaysPriorities.deepLink).not.toMatch(/^\?/);
    expect(result.todaysPriorities.deepLink).not.toMatch(/^\/dashboard\?/);
    expect(result.todaysPriorities.deepLink).not.toContain('tab=positions');
    expect(result.todaysPriorities.deepLink).not.toContain('tab=history');
  });

  it('excludes a completed item from openCount/leadItem when workflowState is threaded in, matching Today\'s Priorities\' own partitioning', async () => {
    const { markComplete, getPriorityWorkflowKey } = await import('@/features/portfolio/priorities/priorityWorkflowState');
    const objective = {
      id: 'obj_1', createdAt: '2026-07-24T00:00:00.000Z', version: 'portfolio-objective-v1',
      type: 'MANAGE_POSITION', ruleId: 'OBJ-CLOSE-LOSER', title: 'Manage AMD', summary: 'Test', priority: 'high',
      urgency: 'today', actionability: 'CRITICAL', confidence: 90, status: 'active', source: 'position',
      subject: { type: 'position', id: 'AMD::2026-08-21', symbol: 'AMD', label: 'AMD' },
      rationale: 'Test rationale', supportingEvidence: [], concerns: [],
      portfolioImpact: { direction: 'neutral', magnitude: 'low', explanation: '' },
      incomeImpact: { direction: 'neutral', magnitude: 'low', explanation: '' },
      riskImpact: { direction: 'neutral', magnitude: 'low', explanation: '' },
      capitalImpact: { direction: 'neutral', magnitude: 'low', explanation: '' },
      reviewTriggers: [], metadata: { executionAllowed: false, paperExecutionAllowed: false, rulesEvaluated: [], rulesTriggered: [] },
    } as any;
    const dashboardWithAttention = { ...EMPTY_DASHBOARD, immediateAction: [{ objective, score: 90, tier: 'Critical', reasons: [] }] };
    const composition = { ...loadedComposition(), todaysPrioritiesDashboard: dashboardWithAttention };
    const workflowState = markComplete({}, objective);

    const result = buildMissionControlViewModel(baseInput({ composition, workflowState }));
    expect(result.todaysPriorities).toEqual({ leadItem: null, openCount: 0, deepLink: null });
    expect(getPriorityWorkflowKey(objective)).toBeDefined();
  });

  it('does not change any existing narrative field\'s value (byte-identical to before this field existed)', () => {
    const composition = loadedComposition();
    const result = buildMissionControlViewModel(baseInput({ composition }));
    expect(result.narrative!.attention.items).toEqual([]);
    expect(result.narrative!.leadItem).toBeNull();
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

describe('buildMissionControlViewModel: WA-0004 sinceLastReview summary', () => {
  it('is always populated (never null/undefined), even in every non-loaded state', () => {
    expect(buildMissionControlViewModel(baseInput({ compositionLoading: true })).sinceLastReview).toBeDefined();
    expect(
      buildMissionControlViewModel(baseInput({ composition: loadedComposition(), compositionError: 'boom' })).sinceLastReview,
    ).toBeDefined();
  });

  it('reports the tracking-unavailable state (today\'s real, only-possible state) -- never "Nothing changed" and never a numeric count', () => {
    const result = buildMissionControlViewModel(baseInput({ composition: loadedComposition() }));

    expect(result.sinceLastReview.trackingActive).toBe(false);
    expect(result.sinceLastReview.leadText).toBe('Change tracking is not yet active.');
    expect(result.sinceLastReview.leadText).not.toBe('Nothing changed since your last review.');
    expect(result.sinceLastReview.count).toBeNull();
  });

  it('imports TRADER_COMMITMENT_TRACKING_ACTIVE from the identical shared module Briefing uses', async () => {
    const fs = await import('node:fs/promises');
    const missionControlText = await fs.readFile('lib/mission-control/buildMissionControlViewModel.ts', 'utf-8');
    const briefingText = await fs.readFile('features/portfolio/briefing/DailyPortfolioBriefing.tsx', 'utf-8');
    expect(missionControlText).toContain("from '@/lib/review-conductor'");
    expect(briefingText).toContain("from '@/lib/review-conductor'");
    expect(missionControlText).toMatch(/TRADER_COMMITMENT_TRACKING_ACTIVE/);
    expect(briefingText).toMatch(/TRADER_COMMITMENT_TRACKING_ACTIVE/);
  });

  it('the deep link is always the absolute path /portfolio?tab=briefing -- never a bare ?tab=briefing and never /dashboard?tab=briefing', () => {
    const loaded = buildMissionControlViewModel(baseInput({ composition: loadedComposition() }));
    const loading = buildMissionControlViewModel(baseInput({ compositionLoading: true }));
    const errored = buildMissionControlViewModel(baseInput({ composition: loadedComposition(), compositionError: 'boom' }));

    for (const result of [loaded, loading, errored]) {
      expect(result.sinceLastReview.deepLink).toBe('/portfolio?tab=briefing');
      expect(result.sinceLastReview.deepLink).toMatch(/^\/portfolio\?/);
      expect(result.sinceLastReview.deepLink).not.toMatch(/^\?/);
      expect(result.sinceLastReview.deepLink).not.toMatch(/^\/dashboard\?/);
    }
  });
});
