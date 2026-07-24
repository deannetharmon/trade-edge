// lib/morning-briefing/__tests__/attentionFeed.test.ts
//
// MB-0001A: coverage for the Attention Feed's pure composition contract --
// mapping, deterministic global ordering, explanation reuse, top-item
// parity with the existing selectTopPriority(), explicit source exclusions,
// input immutability, and repeat-call determinism. Does not re-test
// buildTodaysPrioritiesDashboard, calculatePriorityScore,
// buildRecommendationExplanation, or selectManagementIntent -- those already
// have their own passing test suites, unchanged by this sprint. Fixtures
// build real PortfolioObjective/PrioritizedObjective/TodaysPrioritiesDashboard
// shapes directly (no as any casts), following the same pattern as
// lib/todaysPriorities/__tests__/explanation.test.ts.

import { describe, expect, it } from 'vitest';
import { buildAttentionFeed } from '../attentionFeed';
import {
  buildRecommendationExplanation,
  selectTopPriority,
  type PrioritizedObjective,
  type TodaysPrioritiesDashboard,
  type TodaysPrioritiesMonitorEntry,
} from '@/lib/todaysPriorities';
import type { PortfolioObjective } from '@/lib/portfolio-intelligence';
import type { CoveredCallOpportunityInput } from '@/lib/todaysPriorities';
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

function makeMonitorEntry(overrides: Partial<TodaysPrioritiesMonitorEntry> = {}): TodaysPrioritiesMonitorEntry {
  return {
    key: 'pos_monitor',
    symbol: 'MON',
    strategy: 'CSP',
    dte: 30,
    healthScore: 90,
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

function makeDashboard(overrides: Partial<TodaysPrioritiesDashboard> = {}): TodaysPrioritiesDashboard {
  return {
    immediateAction: [],
    reviewToday: {
      mediumPriority: [],
      earningsReviews: [],
      expiringPositions: [],
      needsFollowUp: [],
    },
    monitor: [],
    opportunities: {
      rollOpportunities: [],
      coveredCallOpportunities: [],
      cspOpportunities: [],
      screenerCandidatesAvailable: false,
    },
    ...overrides,
  };
}

const GENERATED_AT = '2026-07-24T15:00:00.000Z';

describe('buildAttentionFeed: empty dashboard', () => {
  it('returns empty arrays, zero counts, and topAttentionItem: null', () => {
    const feed = buildAttentionFeed({ dashboard: makeDashboard(), generatedAt: GENERATED_AT });

    expect(feed.generatedAt).toBe(GENERATED_AT);
    expect(feed.immediate).toEqual([]);
    expect(feed.watch).toEqual([]);
    expect(feed.healthy).toEqual([]);
    expect(feed.orderedActionable).toEqual([]);
    expect(feed.topAttentionItem).toBeNull();
    expect(feed.counts).toEqual({ immediate: 0, watch: 0, healthy: 0, actionable: 0 });
  });
});

describe('buildAttentionFeed: IMMEDIATE mapping', () => {
  it('maps a CRITICAL/immediateAction objective only to IMMEDIATE, never to WATCH or HEALTHY', () => {
    const critical = makePrioritized({ objective: makeObjective({ actionability: 'CRITICAL' }) });
    const feed = buildAttentionFeed({
      dashboard: makeDashboard({ immediateAction: [critical] }),
      generatedAt: GENERATED_AT,
    });

    expect(feed.immediate).toHaveLength(1);
    expect(feed.immediate[0].band).toBe('IMMEDIATE');
    expect(feed.immediate[0].source).toBe('IMMEDIATE_ACTION');
    expect(feed.immediate[0].id).toBe(critical.objective.id);
    expect(feed.watch).toHaveLength(0);
    expect(feed.healthy).toHaveLength(0);
  });
});

describe('buildAttentionFeed: WATCH mapping', () => {
  it('maps earnings, expiring, medium-priority, roll, and CSP objectives to WATCH with the correct source', () => {
    const earnings = makePrioritized({ objective: makeObjective({ id: 'obj_earnings' }) });
    const expiring = makePrioritized({ objective: makeObjective({ id: 'obj_expiring' }) });
    const medium = makePrioritized({ objective: makeObjective({ id: 'obj_medium' }) });
    const roll = makePrioritized({ objective: makeObjective({ id: 'obj_roll' }) });
    const csp = makePrioritized({ objective: makeObjective({ id: 'obj_csp' }) });

    const feed = buildAttentionFeed({
      dashboard: makeDashboard({
        reviewToday: {
          earningsReviews: [earnings],
          expiringPositions: [expiring],
          mediumPriority: [medium],
          needsFollowUp: [],
        },
        opportunities: {
          rollOpportunities: [roll],
          cspOpportunities: [csp],
          coveredCallOpportunities: [],
          screenerCandidatesAvailable: false,
        },
      }),
      generatedAt: GENERATED_AT,
    });

    expect(feed.watch).toHaveLength(5);
    expect(feed.watch.every((item) => item.band === 'WATCH')).toBe(true);
    const bySource = Object.fromEntries(feed.watch.map((item) => [item.id, item.source]));
    expect(bySource).toEqual({
      obj_earnings: 'EARNINGS_REVIEW',
      obj_expiring: 'EXPIRING_POSITION',
      obj_medium: 'MEDIUM_PRIORITY',
      obj_roll: 'ROLL_OPPORTUNITY',
      obj_csp: 'CSP_OPPORTUNITY',
    });
  });

  it('surfaces the same objective under two sources when Today\'s Priorities itself already does (e.g. a DEPLOY_IDLE_CASH objective in both mediumPriority and cspOpportunities) -- this module flattens honestly, it does not deduplicate across sections', () => {
    const shared = makePrioritized({ objective: makeObjective({ id: 'obj_shared', type: 'DEPLOY_IDLE_CASH' }) });

    const feed = buildAttentionFeed({
      dashboard: makeDashboard({
        reviewToday: {
          mediumPriority: [shared],
          earningsReviews: [],
          expiringPositions: [],
          needsFollowUp: [],
        },
        opportunities: {
          cspOpportunities: [shared],
          rollOpportunities: [],
          coveredCallOpportunities: [],
          screenerCandidatesAvailable: false,
        },
      }),
      generatedAt: GENERATED_AT,
    });

    expect(feed.watch).toHaveLength(2);
    expect(feed.watch.map((item) => item.id)).toEqual(['obj_shared', 'obj_shared']);
    expect(feed.watch.map((item) => item.source).sort()).toEqual(['CSP_OPPORTUNITY', 'MEDIUM_PRIORITY']);
  });
});

describe('buildAttentionFeed: HEALTHY mapping', () => {
  it('maps monitor positions to HEALTHY without fabricating score, tier, explanation, or objective', () => {
    const entry = makeMonitorEntry({ key: 'pos_mon', symbol: 'SOXL', strategy: 'BPS' });
    const feed = buildAttentionFeed({ dashboard: makeDashboard({ monitor: [entry] }), generatedAt: GENERATED_AT });

    expect(feed.healthy).toHaveLength(1);
    const [item] = feed.healthy;
    expect(item.band).toBe('HEALTHY');
    expect(item.source).toBe('MONITOR');
    expect(item.score).toBeNull();
    expect(item.tier).toBeNull();
    expect(item.explanation).toBeNull();
    expect(item.objective).toBeNull();
    expect(item.reasons).toEqual([]);
    expect(item.symbol).toBe('SOXL');
    expect(item.strategy).toBe('BPS');
    expect(item.id).toBe('pos_mon');
    expect(item.recommendedAction.length).toBeGreaterThan(0);
  });
});

describe('buildAttentionFeed: deterministic global ordering (orderedActionable)', () => {
  it('sorts higher score first across different source buckets', () => {
    const low = makePrioritized({ objective: makeObjective({ id: 'obj_low' }), score: 40 });
    const high = makePrioritized({ objective: makeObjective({ id: 'obj_high' }), score: 90 });

    const feed = buildAttentionFeed({
      dashboard: makeDashboard({
        reviewToday: { earningsReviews: [low], mediumPriority: [], expiringPositions: [], needsFollowUp: [] },
        opportunities: {
          cspOpportunities: [high],
          rollOpportunities: [],
          coveredCallOpportunities: [],
          screenerCandidatesAvailable: false,
        },
      }),
      generatedAt: GENERATED_AT,
    });

    expect(feed.orderedActionable.map((item) => item.id)).toEqual(['obj_high', 'obj_low']);
  });

  it('breaks an equal score by source precedence, deterministically', () => {
    const medium = makePrioritized({ objective: makeObjective({ id: 'obj_medium' }), score: 50 });
    const earnings = makePrioritized({ objective: makeObjective({ id: 'obj_earnings' }), score: 50 });

    const feed = buildAttentionFeed({
      dashboard: makeDashboard({
        reviewToday: { mediumPriority: [medium], earningsReviews: [earnings], expiringPositions: [], needsFollowUp: [] },
      }),
      generatedAt: GENERATED_AT,
    });

    // EARNINGS_REVIEW precedes MEDIUM_PRIORITY in the CES's source-precedence
    // order, regardless of which bucket was populated/read first.
    expect(feed.orderedActionable.map((item) => item.id)).toEqual(['obj_earnings', 'obj_medium']);
  });

  it('breaks an equal score and equal source by lexical id ascending, not insertion order', () => {
    const b = makePrioritized({ objective: makeObjective({ id: 'obj_b' }), score: 50 });
    const a = makePrioritized({ objective: makeObjective({ id: 'obj_a' }), score: 50 });

    // Deliberately inserted in reverse-lexical order (b before a) to prove
    // the tie-break is not incidental array order.
    const feed = buildAttentionFeed({
      dashboard: makeDashboard({
        reviewToday: { mediumPriority: [b, a], earningsReviews: [], expiringPositions: [], needsFollowUp: [] },
      }),
      generatedAt: GENERATED_AT,
    });

    expect(feed.orderedActionable.map((item) => item.id)).toEqual(['obj_a', 'obj_b']);
  });
});

describe('buildAttentionFeed: explanation reuse', () => {
  it('attaches buildRecommendationExplanation output unchanged in meaning, not recalculated', () => {
    const prioritized = makePrioritized({
      objective: makeObjective({
        confidence: 92,
        supportingEvidence: [{ id: 'ev1', label: 'Net Edge', value: '0.82 -> 0.47', tone: 'negative', explanation: 'Net edge fell.' }],
        reviewTriggers: [{ id: 'trig1', label: 'Risk', triggerType: 'risk', explanation: 'Loss threshold crossed.' }],
      }),
      reasons: ['Recommendation: Reduce Risk', 'Net Edge deteriorating rapidly'],
    });
    const expected = buildRecommendationExplanation(prioritized);

    const feed = buildAttentionFeed({
      dashboard: makeDashboard({
        reviewToday: { mediumPriority: [prioritized], earningsReviews: [], expiringPositions: [], needsFollowUp: [] },
      }),
      generatedAt: GENERATED_AT,
    });

    const [item] = feed.watch;
    expect(item.explanation).not.toBeNull();
    expect(item.explanation?.confidenceLabel).toBe(expected.confidence.label);
    expect(item.explanation?.confidenceScore).toBe(expected.confidence.score);
    expect(item.explanation?.whyNow).toEqual(expected.whyNow);
    expect(item.explanation?.decisionDrivers).toEqual(
      expected.drivers.map((driver) => (driver.value !== undefined && driver.value !== '' ? `${driver.label}: ${driver.value}` : driver.label)),
    );
    // The raw Priority Score reasons are preserved separately from the
    // explanation's own (deduplicated/capped) decision drivers.
    expect(item.reasons).toEqual(prioritized.reasons);
  });
});

describe('buildAttentionFeed: topAttentionItem parity with selectTopPriority()', () => {
  it('identifies the same objective as the existing selectTopPriority() for the same dashboard', () => {
    // Distinct scores across every bucket selectTopPriority() and
    // orderedActionable both consider, so there is no cross-bucket tie for
    // either algorithm's own tie-break rule to disagree over.
    const weakCritical = makePrioritized({ objective: makeObjective({ id: 'obj_weak_critical', actionability: 'CRITICAL' }), score: 20 });
    const strongMedium = makePrioritized({ objective: makeObjective({ id: 'obj_strong_medium' }), score: 95 });
    const midRoll = makePrioritized({ objective: makeObjective({ id: 'obj_mid_roll' }), score: 60 });

    const dashboard = makeDashboard({
      immediateAction: [weakCritical],
      reviewToday: { mediumPriority: [strongMedium], earningsReviews: [], expiringPositions: [], needsFollowUp: [] },
      opportunities: {
        rollOpportunities: [midRoll],
        cspOpportunities: [],
        coveredCallOpportunities: [],
        screenerCandidatesAvailable: false,
      },
    });

    const expected = selectTopPriority(dashboard);
    const feed = buildAttentionFeed({ dashboard, generatedAt: GENERATED_AT });

    expect(expected?.objective.id).toBe('obj_strong_medium');
    expect(feed.topAttentionItem?.id).toBe(expected?.objective.id);
  });
});

describe('buildAttentionFeed: explicit exclusions', () => {
  it('never converts needsFollowUp, coveredCallOpportunities, or screenerCandidatesAvailable into AttentionItems', () => {
    const review = makeReview();
    const coveredCall: CoveredCallOpportunityInput = { key: 'pos_cc', symbol: 'AMD', shares: 100 };

    const feed = buildAttentionFeed({
      dashboard: makeDashboard({
        reviewToday: { mediumPriority: [], earningsReviews: [], expiringPositions: [], needsFollowUp: [review] },
        opportunities: {
          rollOpportunities: [],
          cspOpportunities: [],
          coveredCallOpportunities: [coveredCall],
          screenerCandidatesAvailable: true,
        },
      }),
      generatedAt: GENERATED_AT,
    });

    expect(feed.immediate).toEqual([]);
    expect(feed.watch).toEqual([]);
    expect(feed.healthy).toEqual([]);
    expect(feed.orderedActionable).toEqual([]);
    expect(feed.topAttentionItem).toBeNull();
    expect(feed.counts).toEqual({ immediate: 0, watch: 0, healthy: 0, actionable: 0 });
  });
});

describe('buildAttentionFeed: determinism and purity', () => {
  it('does not mutate its input dashboard', () => {
    const dashboard = makeDashboard({
      immediateAction: [makePrioritized({ objective: makeObjective({ id: 'obj_immutable' }) })],
      monitor: [makeMonitorEntry()],
    });
    const before = JSON.parse(JSON.stringify(dashboard));

    buildAttentionFeed({ dashboard, generatedAt: GENERATED_AT });

    expect(JSON.parse(JSON.stringify(dashboard))).toEqual(before);
  });

  it('produces deeply equal output across repeated calls with identical input', () => {
    const dashboard = makeDashboard({
      immediateAction: [makePrioritized({ objective: makeObjective({ id: 'obj_repeat' }) })],
      monitor: [makeMonitorEntry()],
    });
    const input = { dashboard, generatedAt: GENERATED_AT };

    const first = buildAttentionFeed(input);
    const second = buildAttentionFeed(input);

    expect(second).toEqual(first);
  });
});
