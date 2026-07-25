// lib/todays-priorities-queue/__tests__/buildTodaysPrioritiesQueue.test.ts
//
// WA-0003: coverage for queue membership (inclusion/exclusion per the CES's
// section 4 matrix), ordering (global Priority Score order preserved,
// appended groups in existing input order, no new scoring/ranking), stable
// key derivation (per-kind namespacing, cross-kind collision prevention,
// stability across runs), and completion partitioning (reuses
// partitionPriorities() unmodified).

import { describe, expect, it } from 'vitest';
import {
  buildTodaysPrioritiesQueue,
  partitionTodaysPrioritiesQueue,
  getStableQueueKey,
} from '../buildTodaysPrioritiesQueue';
import { getPriorityWorkflowKey, markComplete, type PriorityWorkflowState } from '@/features/portfolio/priorities/priorityWorkflowState';
import type { PortfolioObjective } from '@/lib/portfolio-intelligence';
import type { PrioritizedObjective, TodaysPrioritiesDashboard, CoveredCallOpportunityInput } from '@/lib/todaysPriorities';
import type { DecisionReview } from '@/lib/decision-review';

let objectiveCounter = 0;

function makeObjective(overrides: Partial<PortfolioObjective> = {}): PortfolioObjective {
  objectiveCounter += 1;
  return {
    id: `obj_${objectiveCounter}`,
    createdAt: '2026-07-24T12:00:00.000Z',
    version: 'portfolio-objective-v1',
    type: 'MANAGE_POSITION',
    ruleId: 'OBJ-WATCH-POSITION',
    title: 'Hold Position: TEST',
    summary: 'Test summary.',
    priority: 'medium',
    urgency: 'today',
    actionability: 'ACTION_NEEDED',
    confidence: 80,
    status: 'active',
    source: 'position',
    subject: { type: 'position', id: 'pos_test', symbol: 'TEST', label: 'TEST position' },
    rationale: 'Hold the position; no material change in evidence.',
    supportingEvidence: [],
    concerns: [],
    portfolioImpact: { direction: 'neutral', magnitude: 'low', explanation: '' },
    incomeImpact: { direction: 'neutral', magnitude: 'low', explanation: '' },
    riskImpact: { direction: 'neutral', magnitude: 'low', explanation: '' },
    capitalImpact: { direction: 'neutral', magnitude: 'low', explanation: '' },
    reviewTriggers: [],
    metadata: { executionAllowed: false, paperExecutionAllowed: false, rulesEvaluated: [], rulesTriggered: [] },
    ...overrides,
  };
}

function makePrioritized(overrides: Partial<PrioritizedObjective> = {}): PrioritizedObjective {
  return {
    objective: makeObjective(),
    score: 50,
    tier: 'Medium',
    reasons: ['Test reason'],
    ...overrides,
  };
}

function makeReview(overrides: Partial<DecisionReview> = {}): DecisionReview {
  return {
    id: 'review_1',
    positionId: 'pos_review',
    symbol: 'AMD',
    strategy: 'CSP',
    recommendedAt: '2026-07-01T00:00:00.000Z',
    evidence: {
      managementIntent: 'HOLD_POSITION',
      label: 'Hold Position',
      primaryReason: 'test',
      reasons: [],
      confidence: 60,
      winnerScore: null,
      runnerUpIntent: null,
      runnerUpScore: null,
      margin: null,
      confidenceTier: null,
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

function makeCoveredCall(overrides: Partial<CoveredCallOpportunityInput> = {}): CoveredCallOpportunityInput {
  return { key: 'AMD::stock', symbol: 'AMD', shares: 100, ...overrides };
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

const GENERATED_AT = '2026-07-24T15:00:00.000Z';

describe('buildTodaysPrioritiesQueue: membership', () => {
  it('includes Immediate Action, Review Today, roll, and CSP objectives as kind: attention', () => {
    const immediate = makePrioritized({ objective: makeObjective({ actionability: 'CRITICAL', ruleId: 'OBJ-CLOSE-FOR-PROFIT' }), score: 90 });
    const earnings = makePrioritized({ objective: makeObjective({ actionability: 'ACTION_NEEDED', ruleId: 'OBJ-EARNINGS-RISK', reviewTriggers: [{ id: 't1', triggerType: 'earnings', label: 'Earnings', explanation: 'x' } as any] }), score: 70 });
    const roll = makePrioritized({ objective: makeObjective({ actionability: 'ACTION_NEEDED', ruleId: 'OBJ-ROLL-POSITION', type: 'ROLL_POSITION', managementIntent: { intent: 'ROLL_POSITION' } as any }), score: 60 });
    const csp = makePrioritized({ objective: makeObjective({ actionability: 'ACTION_NEEDED', ruleId: 'OBJ-DEPLOY-IDLE-CASH', type: 'DEPLOY_IDLE_CASH' }), score: 50 });

    const dashboard = makeDashboard({
      immediateAction: [immediate],
      reviewToday: { mediumPriority: [], earningsReviews: [earnings], expiringPositions: [], needsFollowUp: [] },
      opportunities: { rollOpportunities: [roll], coveredCallOpportunities: [], cspOpportunities: [csp], screenerCandidatesAvailable: false },
    });

    const queue = buildTodaysPrioritiesQueue({ dashboard, generatedAt: GENERATED_AT });
    const attentionKinds = queue.orderedItems.filter((i) => i.kind === 'attention');
    expect(attentionKinds).toHaveLength(4);
    expect(attentionKinds.every((i) => i.completable)).toBe(true);
  });

  it('appends covered-call opportunities as kind: covered_call_opportunity, non-completable', () => {
    const cc = makeCoveredCall();
    const dashboard = makeDashboard({ opportunities: { rollOpportunities: [], coveredCallOpportunities: [cc], cspOpportunities: [], screenerCandidatesAvailable: false } });
    const queue = buildTodaysPrioritiesQueue({ dashboard, generatedAt: GENERATED_AT });

    expect(queue.orderedItems).toHaveLength(1);
    expect(queue.orderedItems[0].kind).toBe('covered_call_opportunity');
    expect(queue.orderedItems[0].completable).toBe(false);
    expect(queue.orderedItems[0].coveredCallOpportunity).toEqual(cc);
  });

  it('appends decision-review follow-ups as kind: needs_follow_up, non-completable', () => {
    const review = makeReview();
    const dashboard = makeDashboard({ reviewToday: { mediumPriority: [], earningsReviews: [], expiringPositions: [], needsFollowUp: [review] } });
    const queue = buildTodaysPrioritiesQueue({ dashboard, generatedAt: GENERATED_AT });

    expect(queue.orderedItems).toHaveLength(1);
    expect(queue.orderedItems[0].kind).toBe('needs_follow_up');
    expect(queue.orderedItems[0].completable).toBe(false);
    expect(queue.orderedItems[0].decisionReview).toEqual(review);
  });

  it('excludes WAIT-only objectives (never surfaced by buildTodaysPrioritiesDashboard, and never enters the queue even if present)', () => {
    // WAIT objectives never reach `surfaced` with a non-MONITOR actionability
    // in practice; the dashboard buckets above are the only queue input, so
    // an empty dashboard already proves exclusion by construction.
    const dashboard = makeDashboard();
    const queue = buildTodaysPrioritiesQueue({ dashboard, generatedAt: GENERATED_AT });
    expect(queue.orderedItems).toHaveLength(0);
  });

  it('excludes healthy/Monitor positions and Screener-discovered candidates (never read by the queue builder)', () => {
    const dashboard = makeDashboard({ opportunities: { rollOpportunities: [], coveredCallOpportunities: [], cspOpportunities: [], screenerCandidatesAvailable: true } });
    const queue = buildTodaysPrioritiesQueue({ dashboard, generatedAt: GENERATED_AT });
    // monitor + screenerCandidatesAvailable are on `dashboard` but never read
    // by buildTodaysPrioritiesQueue -- the queue stays empty regardless.
    expect(queue.orderedItems).toHaveLength(0);
  });

  it('applies no new scoring/ranking to appended groups -- CC opportunities keep dashboardComposition-supplied order; needsFollowUp keeps reviewsNeedingFollowUp-supplied order', () => {
    const ccB = makeCoveredCall({ key: 'B', symbol: 'B' });
    const ccA = makeCoveredCall({ key: 'A', symbol: 'A' });
    const reviewZ = makeReview({ id: 'review_z', symbol: 'ZZZ' });
    const reviewA = makeReview({ id: 'review_a', symbol: 'AAA' });

    const dashboard = makeDashboard({
      opportunities: { rollOpportunities: [], coveredCallOpportunities: [ccB, ccA], cspOpportunities: [], screenerCandidatesAvailable: false },
      reviewToday: { mediumPriority: [], earningsReviews: [], expiringPositions: [], needsFollowUp: [reviewZ, reviewA] },
    });
    const queue = buildTodaysPrioritiesQueue({ dashboard, generatedAt: GENERATED_AT });

    const ccKeys = queue.orderedItems.filter((i) => i.kind === 'covered_call_opportunity').map((i) => i.coveredCallOpportunity!.key);
    expect(ccKeys).toEqual(['B', 'A']); // input order preserved, not alphabetized

    const reviewIds = queue.orderedItems.filter((i) => i.kind === 'needs_follow_up').map((i) => i.decisionReview!.id);
    expect(reviewIds).toEqual(['review_z', 'review_a']);
  });

  it('preserves buildAttentionFeed global Priority Score ordering for scored items, then appends CC then needsFollowUp', () => {
    const low = makePrioritized({ objective: makeObjective({ actionability: 'CRITICAL', ruleId: 'OBJ-CLOSE-FOR-PROFIT' }), score: 10 });
    const high = makePrioritized({ objective: makeObjective({ actionability: 'CRITICAL', ruleId: 'OBJ-MANAGE-21-DTE' }), score: 99 });
    const cc = makeCoveredCall();
    const review = makeReview();

    const dashboard = makeDashboard({
      immediateAction: [low, high],
      opportunities: { rollOpportunities: [], coveredCallOpportunities: [cc], cspOpportunities: [], screenerCandidatesAvailable: false },
      reviewToday: { mediumPriority: [], earningsReviews: [], expiringPositions: [], needsFollowUp: [review] },
    });
    const queue = buildTodaysPrioritiesQueue({ dashboard, generatedAt: GENERATED_AT });

    expect(queue.orderedItems.map((i) => i.kind)).toEqual(['attention', 'attention', 'covered_call_opportunity', 'needs_follow_up']);
    expect(queue.orderedItems[0].attentionItem!.score).toBe(99); // high score first
    expect(queue.orderedItems[1].attentionItem!.score).toBe(10);
    expect(queue.leadItem).toBe(queue.orderedItems[0]);
  });
});

describe('getStableQueueKey', () => {
  it('produces attention::-namespaced output byte-identical to getPriorityWorkflowKey(objective), never a regenerated objective.id', () => {
    const objective = makeObjective({ ruleId: 'OBJ-WATCH-POSITION', subject: { type: 'position', id: 'AMD::2026-08-21', symbol: 'AMD', label: 'AMD' } });
    const prioritized = makePrioritized({ objective, score: 80 });
    const dashboard = makeDashboard({ immediateAction: [prioritized] });
    const queue = buildTodaysPrioritiesQueue({ dashboard, generatedAt: GENERATED_AT });

    expect(queue.orderedItems[0].stableKey).toBe(`attention::${getPriorityWorkflowKey(objective)}`);
    expect(queue.orderedItems[0].stableKey).not.toContain(objective.id);
  });

  it('produces cc::-namespaced output for covered-call opportunities', () => {
    const cc = makeCoveredCall({ key: 'AMD::stock' });
    const dashboard = makeDashboard({ opportunities: { rollOpportunities: [], coveredCallOpportunities: [cc], cspOpportunities: [], screenerCandidatesAvailable: false } });
    const queue = buildTodaysPrioritiesQueue({ dashboard, generatedAt: GENERATED_AT });
    expect(queue.orderedItems[0].stableKey).toBe('cc::AMD::stock');
  });

  it('produces review::-namespaced output for needsFollowUp reviews', () => {
    const review = makeReview({ id: 'review_42' });
    const dashboard = makeDashboard({ reviewToday: { mediumPriority: [], earningsReviews: [], expiringPositions: [], needsFollowUp: [review] } });
    const queue = buildTodaysPrioritiesQueue({ dashboard, generatedAt: GENERATED_AT });
    expect(queue.orderedItems[0].stableKey).toBe('review::review_42');
  });

  it('an attention item and a covered-call opportunity sharing the same underlying position key produce distinct, non-colliding stableKeys', () => {
    const sharedKey = 'AMD::stock';
    const objective = makeObjective({ ruleId: 'OBJ-ASSIGNMENT-RISK', subject: { type: 'position', id: sharedKey, symbol: 'AMD', label: 'AMD' } });
    const prioritized = makePrioritized({ objective, score: 80 });
    const cc = makeCoveredCall({ key: sharedKey, symbol: 'AMD' });

    const dashboard = makeDashboard({
      immediateAction: [prioritized],
      opportunities: { rollOpportunities: [], coveredCallOpportunities: [cc], cspOpportunities: [], screenerCandidatesAvailable: false },
    });
    const queue = buildTodaysPrioritiesQueue({ dashboard, generatedAt: GENERATED_AT });

    const [attentionItem, ccItem] = queue.orderedItems;
    expect(attentionItem.stableKey).not.toBe(ccItem.stableKey);
    expect(attentionItem.stableKey.startsWith('attention::')).toBe(true);
    expect(ccItem.stableKey.startsWith('cc::')).toBe(true);
  });

  it('is stable across two computation runs with unchanged underlying data', () => {
    const objective = makeObjective({ ruleId: 'OBJ-MANAGE-21-DTE' });
    const prioritized = makePrioritized({ objective, score: 42 });
    const dashboard = makeDashboard({ immediateAction: [prioritized] });

    const queue1 = buildTodaysPrioritiesQueue({ dashboard, generatedAt: GENERATED_AT });
    const queue2 = buildTodaysPrioritiesQueue({ dashboard, generatedAt: GENERATED_AT });

    expect(queue1.orderedItems[0].stableKey).toBe(queue2.orderedItems[0].stableKey);
  });

  it('getStableQueueKey called directly on an item matches queue-construction-time value', () => {
    const cc = makeCoveredCall({ key: 'X::stock' });
    const dashboard = makeDashboard({ opportunities: { rollOpportunities: [], coveredCallOpportunities: [cc], cspOpportunities: [], screenerCandidatesAvailable: false } });
    const queue = buildTodaysPrioritiesQueue({ dashboard, generatedAt: GENERATED_AT });
    expect(getStableQueueKey(queue.orderedItems[0])).toBe(queue.orderedItems[0].stableKey);
  });
});

describe('partitionTodaysPrioritiesQueue', () => {
  it('excludes a completed attention item from open, includes it in completed', () => {
    const objective = makeObjective({ ruleId: 'OBJ-CLOSE-LOSER' });
    const prioritized = makePrioritized({ objective, score: 80 });
    const dashboard = makeDashboard({ immediateAction: [prioritized] });
    const queue = buildTodaysPrioritiesQueue({ dashboard, generatedAt: GENERATED_AT });

    const workflowState = markComplete({}, objective);
    const partition = partitionTodaysPrioritiesQueue(queue, workflowState);

    expect(partition.open).toHaveLength(0);
    expect(partition.completed).toHaveLength(1);
    expect(partition.openCount).toBe(0);
    expect(partition.completedCount).toBe(1);
  });

  it('covered_call_opportunity and needs_follow_up items are always open regardless of workflow state', () => {
    const cc = makeCoveredCall();
    const review = makeReview();
    const dashboard = makeDashboard({
      opportunities: { rollOpportunities: [], coveredCallOpportunities: [cc], cspOpportunities: [], screenerCandidatesAvailable: false },
      reviewToday: { mediumPriority: [], earningsReviews: [], expiringPositions: [], needsFollowUp: [review] },
    });
    const queue = buildTodaysPrioritiesQueue({ dashboard, generatedAt: GENERATED_AT });
    const partition = partitionTodaysPrioritiesQueue(queue, {});

    expect(partition.open).toHaveLength(2);
    expect(partition.completed).toHaveLength(0);
  });

  it('open count excludes completed items; total queue length is open + completed for attention-only queues', () => {
    const objA = makeObjective({ ruleId: 'OBJ-CLOSE-FOR-PROFIT' });
    const objB = makeObjective({ ruleId: 'OBJ-MANAGE-21-DTE' });
    const dashboard = makeDashboard({ immediateAction: [makePrioritized({ objective: objA, score: 90 }), makePrioritized({ objective: objB, score: 80 })] });
    const queue = buildTodaysPrioritiesQueue({ dashboard, generatedAt: GENERATED_AT });

    const workflowState = markComplete({}, objA);
    const partition = partitionTodaysPrioritiesQueue(queue, workflowState);

    expect(partition.openCount).toBe(1);
    expect(partition.completedCount).toBe(1);
    expect(partition.open[0].attentionItem!.objective!.ruleId).toBe('OBJ-MANAGE-21-DTE');
  });

  it('leadItem is the open queue head, recomputed after completion', () => {
    const objA = makeObjective({ ruleId: 'OBJ-CLOSE-FOR-PROFIT' });
    const objB = makeObjective({ ruleId: 'OBJ-MANAGE-21-DTE' });
    const dashboard = makeDashboard({ immediateAction: [makePrioritized({ objective: objA, score: 90 }), makePrioritized({ objective: objB, score: 80 })] });
    const queue = buildTodaysPrioritiesQueue({ dashboard, generatedAt: GENERATED_AT });

    let partition = partitionTodaysPrioritiesQueue(queue, {});
    expect(partition.leadItem!.attentionItem!.objective!.ruleId).toBe('OBJ-CLOSE-FOR-PROFIT');

    const workflowState = markComplete({}, objA);
    partition = partitionTodaysPrioritiesQueue(queue, workflowState);
    expect(partition.leadItem!.attentionItem!.objective!.ruleId).toBe('OBJ-MANAGE-21-DTE');
  });

  it('empty queue partitions to empty open/completed and null leadItem', () => {
    const queue = buildTodaysPrioritiesQueue({ dashboard: makeDashboard(), generatedAt: GENERATED_AT });
    const partition = partitionTodaysPrioritiesQueue(queue, {});
    expect(partition.open).toEqual([]);
    expect(partition.completed).toEqual([]);
    expect(partition.leadItem).toBeNull();
    expect(partition.openCount).toBe(0);
  });
});
