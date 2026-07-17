// lib/dailyBriefing/__tests__/buildDailyBriefing.test.ts
//
// PI-0013: Daily Briefing Dashboard -- targeted tests for the pure
// composition/orchestration logic: verbatim reuse of Portfolio Review's Top
// Risks (no re-ranking), deterministic executive-summary generation, and
// the Upcoming Events / Opportunity Summary / Risk Summary groupings, each
// built from already-existing dashboard/objective data.

import { describe, expect, it } from 'vitest';
import { buildDailyBriefing } from '../buildDailyBriefing';
import type { DailyBriefingInput } from '../types';
import type { PortfolioObjective, ObjectiveImpact } from '@/lib/portfolio-intelligence';
import type { PrioritizedObjective, TodaysPrioritiesDashboard } from '@/lib/todaysPriorities';
import type { PortfolioReviewSnapshot } from '@/lib/portfolioReview';
import type { DecisionReview } from '@/lib/decision-review';

let objectiveCounter = 0;

const NEUTRAL_IMPACT: ObjectiveImpact = { direction: 'neutral', magnitude: 'low', explanation: '' };

function makeObjective(overrides: Partial<PortfolioObjective> = {}): PortfolioObjective {
  objectiveCounter += 1;
  return {
    id: `obj_${objectiveCounter}`,
    createdAt: '2026-07-17T00:00:00.000Z',
    version: 'portfolio-objective-v1',
    type: 'MANAGE_POSITION',
    ruleId: 'OBJ-WATCH-POSITION',
    title: 'Manage Position',
    summary: 'test summary',
    priority: 'medium',
    urgency: 'this_week',
    actionability: 'REVIEW_SOON',
    confidence: 70,
    status: 'active',
    source: 'position',
    subject: { type: 'position', id: 'pos_1', symbol: 'SOXL', label: 'SOXL' },
    rationale: 'test rationale',
    supportingEvidence: [],
    concerns: [],
    portfolioImpact: NEUTRAL_IMPACT,
    incomeImpact: NEUTRAL_IMPACT,
    riskImpact: NEUTRAL_IMPACT,
    capitalImpact: NEUTRAL_IMPACT,
    reviewTriggers: [],
    metadata: { executionAllowed: false, paperExecutionAllowed: false, rulesEvaluated: [], rulesTriggered: [] },
    ...overrides,
  };
}

function makePrioritized(overrides: Partial<PortfolioObjective> = {}, score = 50): PrioritizedObjective {
  return {
    objective: makeObjective(overrides),
    score,
    tier: score >= 80 ? 'Critical' : score >= 60 ? 'High' : score >= 40 ? 'Medium' : 'Low',
    reasons: [],
  };
}

function makeDashboard(overrides: Partial<TodaysPrioritiesDashboard> = {}): TodaysPrioritiesDashboard {
  return {
    immediateAction: [],
    reviewToday: { mediumPriority: [], earningsReviews: [], expiringPositions: [], needsFollowUp: [] },
    monitor: [],
    opportunities: { rollOpportunities: [], coveredCallOpportunities: [], cspOpportunities: [], screenerCandidatesAvailable: false },
    ...overrides,
  };
}

function makeReview(overrides: Partial<DecisionReview> = {}): DecisionReview {
  return {
    id: 'review_1',
    positionId: 'pos_amd',
    symbol: 'AMD',
    strategy: 'CSP',
    recommendedAt: '2026-07-01T00:00:00.000Z',
    evidence: {
      managementIntent: 'HOLD', label: 'Hold Position', primaryReason: 'r', reasons: [],
      confidence: 60, winnerScore: null, runnerUpIntent: null, runnerUpScore: null, margin: null, confidenceTier: null,
    },
    traderAction: null,
    traderActionAt: null,
    outcomeStatus: 'PENDING',
    realizedPnl: null,
    notes: '',
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
    ...overrides,
  };
}

function makePortfolioReview(overrides: Partial<PortfolioReviewSnapshot['currentState']> = {}, composition: Partial<PortfolioReviewSnapshot['composition']> = {}): PortfolioReviewSnapshot {
  return {
    generatedAt: '2026-07-17T00:00:00.000Z',
    currentState: {
      health: { score: 82, status: 'Healthy', positiveContributors: [], negativeContributors: [] },
      topRisks: [],
      concentrationConcerns: [],
      capitalConcerns: [],
      incomeConcern: null,
      ...overrides,
    },
    composition: {
      positionCount: 0,
      byStrategy: {},
      symbolConcentrationPct: {},
      maxSymbolConcentrationPct: null,
      wheelManagedFraction: null,
      ...composition,
    },
  };
}

function baseInput(overrides: Partial<DailyBriefingInput> = {}): DailyBriefingInput {
  return {
    portfolioReview: makePortfolioReview(),
    dashboard: makeDashboard(),
    objectives: [],
    averagePositionHealth: null,
    capitalDeploymentPct: null,
    ...overrides,
  };
}

describe('buildDailyBriefing', () => {
  it('handles an empty portfolio cleanly', () => {
    const result = buildDailyBriefing(baseInput());

    expect(result.priorities).toEqual([]);
    expect(result.upcomingEvents).toEqual([]);
    expect(result.risks).toEqual([]);
    expect(result.snapshot.openPositionCount).toBe(0);
    expect(result.snapshot.largestConcentrationPct).toBeNull();
    expect(result.snapshot.averagePositionHealth).toBeNull();
    expect(result.executiveSummary).toContain('No positions require immediate attention today.');
    expect(result.executiveSummary).toContain('No earnings events occur before the next management window.');
  });

  it('reflects a healthy portfolio in the snapshot and executive summary', () => {
    const portfolioReview = makePortfolioReview({ health: { score: 91, status: 'Healthy', positiveContributors: [], negativeContributors: [] } }, { positionCount: 6 });
    const result = buildDailyBriefing(baseInput({ portfolioReview }));

    expect(result.snapshot.healthScore).toBe(91);
    expect(result.snapshot.healthStatus).toBe('Healthy');
    expect(result.executiveSummary.startsWith('Portfolio is Healthy.')).toBe(true);
  });

  it('reflects a portfolio requiring action', () => {
    const portfolioReview = makePortfolioReview({ health: { score: 38, status: 'Action Required', positiveContributors: [], negativeContributors: [{ id: 'x', label: 'Critical positions present' }] } });
    const dashboard = makeDashboard({ immediateAction: [makePrioritized({ title: 'Cut Losses: TSLA' }, 95)] });
    const result = buildDailyBriefing(baseInput({ portfolioReview, dashboard }));

    expect(result.snapshot.healthStatus).toBe('Action Required');
    expect(result.executiveSummary).toContain('Portfolio is Action Required.');
    expect(result.executiveSummary).toContain('1 position requires attention today.');
  });

  it('passes through multiple priorities from Portfolio Review without re-ranking', () => {
    const p1 = makePrioritized({ title: 'A' }, 90);
    const p2 = makePrioritized({ title: 'B' }, 70);
    const p3 = makePrioritized({ title: 'C' }, 50);
    const portfolioReview = makePortfolioReview({ topRisks: [p1, p2, p3] });
    const result = buildDailyBriefing(baseInput({ portfolioReview }));

    expect(result.priorities).toEqual([p1, p2, p3]);
    expect(result.priorities).toHaveLength(3);
  });

  it('returns an empty priorities array when Portfolio Review has none', () => {
    const result = buildDailyBriefing(baseInput());
    expect(result.priorities).toEqual([]);
  });

  it('surfaces upcoming events from the DTE, earnings, and follow-up buckets', () => {
    const dashboard = makeDashboard({
      reviewToday: {
        mediumPriority: [],
        expiringPositions: [makePrioritized({ title: 'Manage 21-DTE: SOXL', subject: { type: 'position', symbol: 'SOXL', label: 'SOXL' } })],
        earningsReviews: [makePrioritized({ title: 'Earnings Risk: AMD', subject: { type: 'position', symbol: 'AMD', label: 'AMD' } })],
        needsFollowUp: [makeReview()],
      },
    });
    const result = buildDailyBriefing(baseInput({ dashboard }));

    expect(result.upcomingEvents).toHaveLength(3);
    expect(result.upcomingEvents.map((e) => e.kind)).toEqual(['dte', 'earnings', 'decision_review_follow_up']);
    expect(result.upcomingEvents[0].symbol).toBe('SOXL');
    expect(result.upcomingEvents[2].symbol).toBe('AMD'); // makeReview()'s symbol
  });

  it('returns no upcoming events when none of the three buckets have entries', () => {
    const result = buildDailyBriefing(baseInput());
    expect(result.upcomingEvents).toEqual([]);
  });

  it('summarizes opportunities from all four existing buckets, including zero counts', () => {
    const dashboard = makeDashboard({
      opportunities: {
        rollOpportunities: [makePrioritized()],
        coveredCallOpportunities: [{ key: 'k1', symbol: 'NVDA', shares: 100 }],
        cspOpportunities: [],
        screenerCandidatesAvailable: true,
      },
    });
    const result = buildDailyBriefing(baseInput({ dashboard }));

    expect(result.opportunities).toHaveLength(4);
    const byKind = Object.fromEntries(result.opportunities.map((o) => [o.kind, o.count]));
    expect(byKind.roll).toBe(1);
    expect(byKind.covered_call).toBe(1);
    expect(byKind.csp).toBe(0);
    expect(byKind.screener).toBe(1);
  });

  it('surfaces risks across all five categories without inventing new ones', () => {
    const portfolioReview = makePortfolioReview({
      concentrationConcerns: [makeObjective({ type: 'REDUCE_CONCENTRATION', title: 'Reduce Concentration: AAPL' })],
      capitalConcerns: [makeObjective({ type: 'PRESERVE_BUYING_POWER', title: 'Preserve Buying Power' })],
    });
    const objectives = [makeObjective({ ruleId: 'OBJ-ASSIGNMENT-RISK', title: 'Assignment Risk: MSFT' })];
    const dashboard = makeDashboard({
      reviewToday: {
        mediumPriority: [], expiringPositions: [], needsFollowUp: [],
        earningsReviews: [makePrioritized({ title: 'Earnings Risk: AMD' })],
      },
      immediateAction: [makePrioritized({ title: 'Cut Losses: TSLA' }, 95)],
    });

    const result = buildDailyBriefing(baseInput({ portfolioReview, objectives, dashboard }));

    const kinds = result.risks.map((r) => r.kind).sort();
    expect(kinds).toEqual(['assignment_exposure', 'capital', 'concentration', 'earnings_exposure', 'immediate_attention']);
  });

  it('passes through missing optional data (null averagePositionHealth/capitalDeploymentPct) without fabricating values', () => {
    const result = buildDailyBriefing(baseInput({ averagePositionHealth: null, capitalDeploymentPct: null }));
    expect(result.snapshot.averagePositionHealth).toBeNull();
    expect(result.snapshot.capitalDeploymentPct).toBeNull();
  });

  it('produces deterministic output for identical input, regardless of call order', () => {
    const input = baseInput({
      dashboard: makeDashboard({ immediateAction: [makePrioritized({ title: 'X' }, 80)] }),
    });
    const now = new Date('2026-07-17T09:00:00.000Z');
    const a = buildDailyBriefing(input, now);
    const b = buildDailyBriefing(input, now);
    expect(a).toEqual(b);
  });

  it('generates an executive summary mentioning health, immediate attention, concentration, and earnings clauses', () => {
    const portfolioReview = makePortfolioReview({
      health: { score: 55, status: 'Needs Attention', positiveContributors: [], negativeContributors: [] },
      concentrationConcerns: [makeObjective({ type: 'REDUCE_CONCENTRATION', title: 'Reduce Concentration: Technology sector' })],
    });
    const dashboard = makeDashboard({ immediateAction: [makePrioritized({}, 80), makePrioritized({}, 81)] });
    const result = buildDailyBriefing(baseInput({ portfolioReview, dashboard }));

    expect(result.executiveSummary).toBe(
      'Portfolio is Needs Attention. 2 positions require attention today. Technology sector concentration remains elevated. No earnings events occur before the next management window.',
    );
  });

  it('stamps generatedAt from the injected clock', () => {
    const now = new Date('2026-07-17T12:00:00.000Z');
    const result = buildDailyBriefing(baseInput(), now);
    expect(result.generatedAt).toBe('2026-07-17T12:00:00.000Z');
  });
});
