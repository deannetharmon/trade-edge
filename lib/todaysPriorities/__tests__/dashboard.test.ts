// lib/todaysPriorities/__tests__/dashboard.test.ts
//
// PI-0010A: Today's Priorities Dashboard, V1 -- targeted tests for the pure
// bucketing logic: actionability-tier mapping, earnings/dte/generic
// sub-grouping within Review Today, Monitor inclusion, and pass-through
// reuse of roll/covered-call/CSP/needs-follow-up data.
// PI-0010B: Intelligent Prioritization -- every objective-bearing bucket now
// returns PrioritizedObjective[] (objective + score/tier/reasons), sorted
// highest score first. Bucketing-assertion tests below were updated to
// unwrap `.objective`; new tests cover score attachment and sort order.

import { describe, expect, it } from 'vitest';
import { buildTodaysPrioritiesDashboard, selectTopPriority } from '../dashboard';
import type { TodaysPrioritiesInput, TodaysPrioritiesPositionInput } from '../dashboard';
import type { PortfolioObjective, PortfolioObjectiveReviewTrigger, ManagementIntentResult, ObjectiveImpact } from '@/lib/portfolio-intelligence';
import type { DecisionReview, DecisionReviewStore } from '@/lib/decision-review';

let objectiveCounter = 0;

const NEUTRAL_IMPACT: ObjectiveImpact = { direction: 'neutral', magnitude: 'low', explanation: '' };

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
    portfolioImpact: NEUTRAL_IMPACT,
    incomeImpact: NEUTRAL_IMPACT,
    riskImpact: NEUTRAL_IMPACT,
    capitalImpact: NEUTRAL_IMPACT,
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
    netEdgeDeclinePct: 0,
    netEdgeNegative: false,
    remainingOpportunityPct: 70,
    capitalAtRisk: 0,
    hasPendingDecisionReview: false,
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
    expect(result.immediateAction.map(p => p.objective)).toEqual([critical]);
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
    expect(result.reviewToday.earningsReviews.map(p => p.objective)).toEqual([earningsObjective]);
    expect(result.reviewToday.mediumPriority).toHaveLength(0);
    expect(result.reviewToday.expiringPositions).toHaveLength(0);
  });

  it('routes objectives with a dte trigger (no earnings) to expiringPositions', () => {
    const dteObjective = makeObjective({ actionability: 'ACTION_NEEDED', reviewTriggers: [makeTrigger('dte')] });
    const result = buildTodaysPrioritiesDashboard(baseInput({ objectives: [dteObjective] }));
    expect(result.reviewToday.expiringPositions.map(p => p.objective)).toEqual([dteObjective]);
    expect(result.reviewToday.mediumPriority).toHaveLength(0);
  });

  it('an objective with both earnings and dte triggers counts as an earnings review, not expiring', () => {
    const both = makeObjective({ actionability: 'REVIEW_SOON', reviewTriggers: [makeTrigger('earnings'), makeTrigger('dte')] });
    const result = buildTodaysPrioritiesDashboard(baseInput({ objectives: [both] }));
    expect(result.reviewToday.earningsReviews.map(p => p.objective)).toEqual([both]);
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
    expect(result.opportunities.rollOpportunities.map(p => p.objective)).toEqual([rollWinner]);
  });

  it('does not surface an objective with no managementIntent at all as a roll opportunity', () => {
    const noIntent = makeObjective({ managementIntent: undefined });
    const result = buildTodaysPrioritiesDashboard(baseInput({ objectives: [noIntent] }));
    expect(result.opportunities.rollOpportunities).toHaveLength(0);
  });

  it('surfaces a DEPLOY_IDLE_CASH objective as a CSP opportunity', () => {
    const idleCash = makeObjective({ type: 'DEPLOY_IDLE_CASH', actionability: 'ACTION_NEEDED' });
    const result = buildTodaysPrioritiesDashboard(baseInput({ objectives: [idleCash] }));
    expect(result.opportunities.cspOpportunities.map(p => p.objective)).toEqual([idleCash]);
    // Also still appears in Review Today via the normal actionability bucketing --
    // this module doesn't hide it from one section to show it in another.
    expect(result.reviewToday.mediumPriority.map(p => p.objective)).toEqual([idleCash]);
  });

  it('passes through screenerCandidatesAvailable unchanged', () => {
    const result = buildTodaysPrioritiesDashboard(baseInput({ screenerCandidatesAvailable: true }));
    expect(result.opportunities.screenerCandidatesAvailable).toBe(true);
  });
});

// PI-0010B: Intelligent Prioritization -- score/tier/reasons attachment and
// descending sort order within a bucket.
describe('buildTodaysPrioritiesDashboard: Priority Score', () => {
  it('attaches a numeric score, a tier, and a reasons array to every prioritized objective', () => {
    const objective = makeObjective({ actionability: 'CRITICAL', confidence: 90 });
    const result = buildTodaysPrioritiesDashboard(baseInput({ objectives: [objective] }));
    const [entry] = result.immediateAction;
    expect(typeof entry.score).toBe('number');
    expect(['Critical', 'High', 'Medium', 'Low']).toContain(entry.tier);
    expect(Array.isArray(entry.reasons)).toBe(true);
  });

  it('sorts a bucket highest score first', () => {
    // Both objectives have no earnings/dte trigger, so both land in the same
    // mediumPriority bucket -- only their scores should determine order.
    const lowUrgency = makeObjective({
      actionability: 'ACTION_NEEDED',
      confidence: 5,
      subject: { type: 'position', id: 'pos_low', label: 'LOW' } as any,
    });
    const highUrgency = makeObjective({
      actionability: 'ACTION_NEEDED',
      confidence: 95,
      managementIntent: makeManagementIntent({ intent: 'CUT_LOSSES' as any }),
      subject: { type: 'position', id: 'pos_high', label: 'HIGH' } as any,
    });
    const lowPosition = makePosition({ key: 'pos_low', dte: 30, healthScore: 95, remainingOpportunityPct: 95 });
    const highPosition = makePosition({ key: 'pos_high', dte: 0, healthScore: 20, netEdgeNegative: true, hasPendingDecisionReview: true });
    const result = buildTodaysPrioritiesDashboard(
      baseInput({ objectives: [lowUrgency, highUrgency], positions: [lowPosition, highPosition] }),
    );
    expect(result.reviewToday.mediumPriority.map(p => p.objective.id)).toEqual([highUrgency.id, lowUrgency.id]);
    expect(result.reviewToday.mediumPriority[0].score).toBeGreaterThan(result.reviewToday.mediumPriority[1].score);
  });

  it('falls back to neutral position-context defaults for a portfolio-level objective with no matching position', () => {
    const idleCash = makeObjective({ type: 'DEPLOY_IDLE_CASH', actionability: 'ACTION_NEEDED', subject: { type: 'portfolio', label: 'Portfolio' } as any });
    const result = buildTodaysPrioritiesDashboard(baseInput({ objectives: [idleCash] }));
    const entry = result.opportunities.cspOpportunities[0];
    expect(entry.score).toBeGreaterThanOrEqual(0);
    expect(entry.score).toBeLessThanOrEqual(100);
  });
});

// PI-0011A: Portfolio Mission Control's "Top Priority" section.
describe('selectTopPriority', () => {
  it('returns null when there is nothing actionable anywhere', () => {
    const result = buildTodaysPrioritiesDashboard(baseInput());
    expect(selectTopPriority(result)).toBeNull();
  });

  it('returns the single highest-scoring entry across every actionable bucket', () => {
    // A CRITICAL objective with weak scoring signals vs. a lower-actionability
    // (ACTION_NEEDED) objective with maximal scoring signals -- selectTopPriority
    // must pick by score, not by which bucket ("Immediate Action" vs.
    // "Review Today") the objective landed in.
    const weakCritical = makeObjective({
      actionability: 'CRITICAL',
      confidence: 1,
      subject: { type: 'position', id: 'pos_weak', label: 'WEAK' } as any,
    });
    const strongActionNeeded = makeObjective({
      actionability: 'ACTION_NEEDED',
      confidence: 99,
      managementIntent: makeManagementIntent({ intent: 'CUT_LOSSES' as any }),
      subject: { type: 'position', id: 'pos_strong', label: 'STRONG' } as any,
    });
    const weakPosition = makePosition({ key: 'pos_weak', dte: 30, healthScore: 100, remainingOpportunityPct: 100 });
    const strongPosition = makePosition({ key: 'pos_strong', dte: 0, healthScore: 5, netEdgeNegative: true, hasPendingDecisionReview: true });
    const result = buildTodaysPrioritiesDashboard(
      baseInput({ objectives: [weakCritical, strongActionNeeded], positions: [weakPosition, strongPosition] }),
    );
    const top = selectTopPriority(result);
    expect(top?.objective.id).toBe(strongActionNeeded.id);
  });

  it('ignores Monitor and Covered Call/Screener buckets (not scored)', () => {
    const monitored = makePosition({ key: 'pos_monitor', objective: makeObjective({ actionability: 'MONITOR' }) });
    const result = buildTodaysPrioritiesDashboard(
      baseInput({ positions: [monitored], coveredCallOpportunities: [{ key: 'pos_cc', symbol: 'CC', shares: 100 }] }),
    );
    expect(selectTopPriority(result)).toBeNull();
  });
});
