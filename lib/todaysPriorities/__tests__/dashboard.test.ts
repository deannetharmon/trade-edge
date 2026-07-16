// lib/todaysPriorities/__tests__/dashboard.test.ts
//
// PI-0010A: Today's Priorities Dashboard, V1 -- targeted tests for the pure
// bucketing logic: actionability-tier mapping, earnings/dte/generic
// sub-grouping within Review Today, Monitor inclusion, and pass-through
// reuse of roll/covered-call/CSP/needs-follow-up data.

import { describe, expect, it } from 'vitest';
import { buildTodaysPrioritiesDashboard } from '../dashboard';
import type { TodaysPrioritiesInput, TodaysPrioritiesPositionInput } from '../dashboard';
import type { PortfolioObjective, PortfolioObjectiveReviewTrigger, ManagementIntentResult } from '@/lib/portfolio-intelligence';
import type { DecisionReview, DecisionReviewStore } from '@/lib/decision-review';

let objectiveCounter = 0;

function makeTrigger(triggerType: PortfolioObjectiveReviewTrigger['triggerType']): PortfolioObjectiveReviewTrigger {
  return { id: `trig_${triggerType}`, label: triggerType, triggerType, explanation: '' };
}

function makeObjective(overrides: Partial<PortfolioObjective> = {}): PortfolioObjective {
  objectiveCounter += 1;
  return {
    id: `obj_${objectiveCounter}`,
    createdAt: '2026-07-01T00:00:00.000Z',
    version: 'portfolio-objective-v1',
    type: 'MANAGE_POSITION',
    ruleId: 'MANAGE_POSITION' as any,
    title: 'Manage Position',
    summary: 'test summary',
    priority: 50 as any,
    urgency: 'moderate' as any,
    actionability: 'ACTION_NEEDED',
    confidence: 70,
    status: 'active',
    source: 'position',
    subject: { type: 'position', id: 'pos_1', label: 'SOXL' } as any,
    rationale: 'test rationale',
    supportingEvidence: [],
    concerns: [],
    portfolioImpact: 'neutral' as any,
    incomeImpact: 'neutral' as any,
    riskImpact: 'neutral' as any,
    capitalImpact: 'neutral' as any,
    reviewTriggers: [],
    metadata: { executionAllowed: false, paperExecutionAllowed: false, rulesEvaluated: [], rulesTriggered: [] },
    ...overrides,
  } as PortfolioObjective;
}

function makePosition(overrides: Partial<TodaysPrioritiesPositionInput> = {}): TodaysPrioritiesPositionInput {
  return {
    key: 'pos_1',
    symbol: 'SOXL',
    strategy: 'BPS',
    dte: 21,
    healthScore: 80,
    objective: null,
    ...overrides,
  };
}

function makeReview(overrides: Partial<DecisionReview> = {}): DecisionReview {
  return {
    id: 'r1',
    positionId: 'pos_pending',
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

function makeManagementIntent(overrides: Partial<ManagementIntentResult> = {}): ManagementIntentResult {
  return {
    intent: 'HOLD_POSITION' as any,
    label: 'Hold Position',
    reasons: [],
    alternatives: [],
    candidates: [],
    winnerScore: 0,
    runnerUpIntent: null,
    runnerUpScore: 0,
    margin: 0,
    confidenceTier: 'Low',
    ...overrides,
  };
}

function baseInput(overrides: Partial<TodaysPrioritiesInput> = {}): TodaysPrioritiesInput {
  return {
    objectives: [],
    positions: [],
    decisionReviews: {},
    openPositionIds: [],
    coveredCallOpportunities: [],
    screenerCandidatesAvailable: false,
    ...overrides,
  };
}

describe('buildTodaysPrioritiesDashboard: actionability bucketing', () => {
  it('puts CRITICAL objectives in Immediate Action', () => {
    const critical = makeObjective({ actionability: 'CRITICAL' });
    const result = buildTodaysPrioritiesDashboard(baseInput({ objectives: [critical] }));
    expect(result.immediateAction).toEqual([critical]);
    expect(result.reviewToday.mediumPriority).toHaveLength(0);
  });

  it('puts ACTION_NEEDED/REVIEW_SOON objectives (no earnings/dte trigger) in Review Today > mediumPriority', () => {
    const actionNeeded = makeObjective({ actionability: 'ACTION_NEEDED' });
    const reviewSoon = makeObjective({ actionability: 'REVIEW_SOON' });
    const result = buildTodaysPrioritiesDashboard(baseInput({ objectives: [actionNeeded, reviewSoon] }));
    expect(result.immediateAction).toHaveLength(0);
    expect(result.reviewToday.mediumPriority).toHaveLength(2);
  });

  it('excludes MONITOR-tier objectives from every Review Today / Immediate Action bucket', () => {
    const monitor = makeObjective({ actionability: 'MONITOR' });
    const result = buildTodaysPrioritiesDashboard(baseInput({ objectives: [monitor] }));
    expect(result.immediateAction).toHaveLength(0);
    expect(result.reviewToday.mediumPriority).toHaveLength(0);
    expect(result.reviewToday.earningsReviews).toHaveLength(0);
    expect(result.reviewToday.expiringPositions).toHaveLength(0);
  });
});

describe('buildTodaysPrioritiesDashboard: Review Today sub-grouping by trigger', () => {
  it('routes objectives with an earnings review trigger to earningsReviews', () => {
    const earningsObjective = makeObjective({ actionability: 'REVIEW_SOON', reviewTriggers: [makeTrigger('earnings')] });
    const result = buildTodaysPrioritiesDashboard(baseInput({ objectives: [earningsObjective] }));
    expect(result.reviewToday.earningsReviews).toEqual([earningsObjective]);
    expect(result.reviewToday.mediumPriority).toHaveLength(0);
    expect(result.reviewToday.expiringPositions).toHaveLength(0);
  });

  it('routes objectives with a dte trigger (no earnings) to expiringPositions', () => {
    const dteObjective = makeObjective({ actionability: 'ACTION_NEEDED', reviewTriggers: [makeTrigger('dte')] });
    const result = buildTodaysPrioritiesDashboard(baseInput({ objectives: [dteObjective] }));
    expect(result.reviewToday.expiringPositions).toEqual([dteObjective]);
    expect(result.reviewToday.mediumPriority).toHaveLength(0);
  });

  it('an objective with both earnings and dte triggers counts as an earnings review, not expiring', () => {
    const both = makeObjective({ actionability: 'REVIEW_SOON', reviewTriggers: [makeTrigger('earnings'), makeTrigger('dte')] });
    const result = buildTodaysPrioritiesDashboard(baseInput({ objectives: [both] }));
    expect(result.reviewToday.earningsReviews).toEqual([both]);
    expect(result.reviewToday.expiringPositions).toHaveLength(0);
  });
});

describe('buildTodaysPrioritiesDashboard: Monitor', () => {
  it('includes positions with no objective at all', () => {
    const healthy = makePosition({ key: 'pos_healthy', objective: null });
    const result = buildTodaysPrioritiesDashboard(baseInput({ positions: [healthy] }));
    expect(result.monitor).toEqual([{ key: 'pos_healthy', symbol: 'SOXL', strategy: 'BPS', dte: 21, healthScore: 80 }]);
  });

  it('includes positions whose own objective is MONITOR-tier', () => {
    const monitored = makePosition({ key: 'pos_monitored', objective: makeObjective({ actionability: 'MONITOR' }) });
    const result = buildTodaysPrioritiesDashboard(baseInput({ positions: [monitored] }));
    expect(result.monitor.map(m => m.key)).toEqual(['pos_monitored']);
  });

  it('excludes positions whose objective needs action', () => {
    const actionable = makePosition({ key: 'pos_actionable', objective: makeObjective({ actionability: 'ACTION_NEEDED' }) });
    const result = buildTodaysPrioritiesDashboard(baseInput({ positions: [actionable] }));
    expect(result.monitor).toHaveLength(0);
  });
});

describe('buildTodaysPrioritiesDashboard: Decision Reviews needing follow-up', () => {
  it('passes through reviewsNeedingFollowUp unchanged', () => {
    const pending = makeReview({ id: 'r_pending', outcomeStatus: 'PENDING', positionId: 'pos_gone' });
    const store: DecisionReviewStore = { r_pending: pending };
    const result = buildTodaysPrioritiesDashboard(baseInput({ decisionReviews: store, openPositionIds: [] }));
    expect(result.reviewToday.needsFollowUp.map(r => r.id)).toEqual(['r_pending']);
  });

  it('does not flag a pending review whose position is still open', () => {
    const pending = makeReview({ id: 'r_pending', outcomeStatus: 'PENDING', positionId: 'pos_open' });
    const store: DecisionReviewStore = { r_pending: pending };
    const result = buildTodaysPrioritiesDashboard(baseInput({ decisionReviews: store, openPositionIds: ['pos_open'] }));
    expect(result.reviewToday.needsFollowUp).toHaveLength(0);
  });
});

describe('buildTodaysPrioritiesDashboard: Opportunities', () => {
  it('passes through covered call opportunities unchanged', () => {
    const cc = { key: 'pos_2', symbol: 'AMD', shares: 100 };
    const result = buildTodaysPrioritiesDashboard(baseInput({ coveredCallOpportunities: [cc] }));
    expect(result.opportunities.coveredCallOpportunities).toEqual([cc]);
  });

  it('surfaces an objective whose managementIntent won ROLL_POSITION as a roll opportunity', () => {
    const rollWinner = makeObjective({ managementIntent: makeManagementIntent({ intent: 'ROLL_POSITION' as any }) });
    const holdOnly = makeObjective({ managementIntent: makeManagementIntent({ intent: 'HOLD_POSITION' as any }) });
    const result = buildTodaysPrioritiesDashboard(baseInput({ objectives: [rollWinner, holdOnly] }));
    expect(result.opportunities.rollOpportunities).toEqual([rollWinner]);
  });

  it('does not surface an objective with no managementIntent at all as a roll opportunity', () => {
    const noIntent = makeObjective({ managementIntent: undefined });
    const result = buildTodaysPrioritiesDashboard(baseInput({ objectives: [noIntent] }));
    expect(result.opportunities.rollOpportunities).toHaveLength(0);
  });

  it('surfaces a DEPLOY_IDLE_CASH objective as a CSP opportunity', () => {
    const idleCash = makeObjective({ type: 'DEPLOY_IDLE_CASH', actionability: 'ACTION_NEEDED' });
    const result = buildTodaysPrioritiesDashboard(baseInput({ objectives: [idleCash] }));
    expect(result.opportunities.cspOpportunities).toEqual([idleCash]);
    // Also still appears in Review Today via the normal actionability bucketing --
    // this module doesn't hide it from one section to show it in another.
    expect(result.reviewToday.mediumPriority).toEqual([idleCash]);
  });

  it('passes through screenerCandidatesAvailable unchanged', () => {
    const result = buildTodaysPrioritiesDashboard(baseInput({ screenerCandidatesAvailable: true }));
    expect(result.opportunities.screenerCandidatesAvailable).toBe(true);
  });
});
