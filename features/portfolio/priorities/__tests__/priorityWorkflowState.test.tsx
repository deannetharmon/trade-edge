// features/portfolio/priorities/__tests__/priorityWorkflowState.test.tsx
//
// PI-0004C: pure-logic + persistence coverage for the workflow-state module
// that backs the Today's Priorities Complete/Reopen workflow. No React
// rendering here -- see TodaysPrioritiesWorkflow.test.tsx for the
// component-level behavior. (.tsx extension only because vitest.config.ts's
// `include` glob only picks up .test.tsx under features/ -- there is no JSX
// in this file.)

import { beforeEach, describe, expect, it } from 'vitest';
import type { PortfolioObjective } from '@/lib/portfolio-intelligence';
import {
  computeObjectiveFingerprint,
  getPriorityWorkflowKey,
  isCompletable,
  loadPriorityWorkflowState,
  markComplete,
  partitionPriorities,
  PRIORITY_WORKFLOW_STORAGE_KEY,
  reopenPriority,
  savePriorityWorkflowState,
  type PriorityWorkflowState,
} from '../priorityWorkflowState';

function makeObjective(overrides: Partial<PortfolioObjective> = {}): PortfolioObjective {
  return {
    id: `obj_${Math.random().toString(36).slice(2, 9)}`,
    createdAt: '2026-07-12T00:00:00.000Z',
    version: 'portfolio-objective-v1',
    type: 'REVIEW_THREATENED_POSITION',
    ruleId: 'OBJ-EARNINGS-RISK',
    title: 'Earnings Risk: AMD',
    summary: 'Upcoming earnings before expiration.',
    priority: 'high',
    urgency: 'today',
    actionability: 'ACTION_NEEDED',
    confidence: 86,
    status: 'active',
    source: 'position',
    subject: { type: 'position', id: 'pos_amd', symbol: 'AMD', label: 'AMD BPS position' },
    rationale: 'Decide whether to close, reduce risk, or hold through earnings.',
    supportingEvidence: [{ id: 'earnings-date', label: 'Earnings date', value: '2026-07-18', tone: 'warning' }],
    concerns: [],
    portfolioImpact: { direction: 'negative', magnitude: 'medium', explanation: 'n/a' },
    incomeImpact: { direction: 'neutral', magnitude: 'low', explanation: 'n/a' },
    riskImpact: { direction: 'negative', magnitude: 'medium', explanation: 'n/a' },
    capitalImpact: { direction: 'neutral', magnitude: 'low', explanation: 'n/a' },
    reviewTriggers: [],
    metadata: { executionAllowed: false, paperExecutionAllowed: false, rulesEvaluated: [], rulesTriggered: [] },
    ...overrides,
  };
}

function makeWait(): PortfolioObjective {
  return makeObjective({
    id: 'obj_wait', type: 'WAIT', ruleId: 'OBJ-WAIT', title: 'No action required', priority: 'informational',
    urgency: 'none', actionability: 'MONITOR', subject: { type: 'portfolio', label: 'Portfolio' },
  });
}

describe('PI-0004C: isCompletable', () => {
  it('WAIT is never completable; everything else is', () => {
    expect(isCompletable(makeWait())).toBe(false);
    expect(isCompletable(makeObjective())).toBe(true);
    expect(isCompletable(makeObjective({ type: 'REDUCE_CONCENTRATION', ruleId: 'OBJ-REDUCE-CONCENTRATION' }))).toBe(true);
  });
});

describe('PI-0004C: getPriorityWorkflowKey', () => {
  it('is stable across different ids/createdAt for the same rule + subject', () => {
    const a = makeObjective({ id: 'obj_1', createdAt: '2026-07-11T00:00:00.000Z' });
    const b = makeObjective({ id: 'obj_2', createdAt: '2026-07-12T00:00:00.000Z' });
    expect(getPriorityWorkflowKey(a)).toBe(getPriorityWorkflowKey(b));
  });

  it('differs for a different subject (different position)', () => {
    const a = makeObjective({ subject: { type: 'position', id: 'pos_amd', symbol: 'AMD', label: 'AMD' } });
    const b = makeObjective({ subject: { type: 'position', id: 'pos_nvda', symbol: 'NVDA', label: 'NVDA' } });
    expect(getPriorityWorkflowKey(a)).not.toBe(getPriorityWorkflowKey(b));
  });

  it('differs for a different ruleId on the same subject', () => {
    const a = makeObjective({ ruleId: 'OBJ-EARNINGS-RISK' });
    const b = makeObjective({ ruleId: 'OBJ-ASSIGNMENT-RISK' });
    expect(getPriorityWorkflowKey(a)).not.toBe(getPriorityWorkflowKey(b));
  });
});

describe('PI-0004C: computeObjectiveFingerprint', () => {
  it('is identical when only id/createdAt differ (no material change)', () => {
    const a = makeObjective({ id: 'obj_1', createdAt: '2026-07-11T00:00:00.000Z' });
    const b = makeObjective({ id: 'obj_2', createdAt: '2026-08-01T00:00:00.000Z' });
    expect(computeObjectiveFingerprint(a)).toBe(computeObjectiveFingerprint(b));
  });

  it('changes when priority changes', () => {
    const a = makeObjective({ priority: 'high' });
    const b = makeObjective({ priority: 'critical' });
    expect(computeObjectiveFingerprint(a)).not.toBe(computeObjectiveFingerprint(b));
  });

  it('changes when actionability changes (e.g. earnings becomes actionable)', () => {
    const a = makeObjective({ actionability: 'MONITOR' });
    const b = makeObjective({ actionability: 'REVIEW_SOON' });
    expect(computeObjectiveFingerprint(a)).not.toBe(computeObjectiveFingerprint(b));
  });

  it('changes when supporting evidence values change (e.g. concentration escalates)', () => {
    const a = makeObjective({ supportingEvidence: [{ id: 'symbol-concentration', label: 'Current vs. limit', value: '13.0% / 10%', tone: 'warning' }] });
    const b = makeObjective({ supportingEvidence: [{ id: 'symbol-concentration', label: 'Current vs. limit', value: '20.0% / 10%', tone: 'negative' }] });
    expect(computeObjectiveFingerprint(a)).not.toBe(computeObjectiveFingerprint(b));
  });
});

describe('PI-0004C: partitionPriorities', () => {
  it('puts everything in open when workflowState is empty', () => {
    const objectives = [makeObjective({ id: 'a' }), makeWait()];
    const { open, completed, reconciliationChanged } = partitionPriorities(objectives, {});
    expect(open).toHaveLength(2);
    expect(completed).toHaveLength(0);
    expect(reconciliationChanged).toBe(false);
  });

  it('moves a completed, unchanged objective into completed and out of open', () => {
    const objective = makeObjective({ id: 'a' });
    const key = getPriorityWorkflowKey(objective);
    const state: PriorityWorkflowState = { [key]: { completedAt: '2026-07-11T00:00:00.000Z', fingerprint: computeObjectiveFingerprint(objective) } };

    const { open, completed, reconciliationChanged } = partitionPriorities([objective], state);
    expect(open).toHaveLength(0);
    expect(completed).toHaveLength(1);
    expect(completed[0].id).toBe('a');
    expect(reconciliationChanged).toBe(false);
  });

  it('WAIT stays in open even if a stale entry exists for its key (defensive -- WAIT is never actually completable)', () => {
    const wait = makeWait();
    const key = getPriorityWorkflowKey(wait);
    const state: PriorityWorkflowState = { [key]: { completedAt: '2026-07-11T00:00:00.000Z', fingerprint: computeObjectiveFingerprint(wait) } };

    const { open, completed } = partitionPriorities([wait], state);
    expect(open).toHaveLength(1);
    expect(completed).toHaveLength(0);
  });

  it('auto-reopens a completed objective whose fingerprint materially changed, and reports reconciliationChanged', () => {
    const original = makeObjective({ id: 'a', priority: 'high' });
    const key = getPriorityWorkflowKey(original);
    const state: PriorityWorkflowState = { [key]: { completedAt: '2026-07-11T00:00:00.000Z', fingerprint: computeObjectiveFingerprint(original) } };

    const escalated = makeObjective({ id: 'a-new', priority: 'critical' }); // same key, different substance
    const { open, completed, reconciledState, reconciliationChanged } = partitionPriorities([escalated], state);

    expect(open).toHaveLength(1);
    expect(open[0].priority).toBe('critical');
    expect(completed).toHaveLength(0);
    expect(reconciliationChanged).toBe(true);
    expect(reconciledState[key]).toBeUndefined();
  });

  it('does not reopen simply because the page refreshed with an identical objective (id/createdAt differ, substance does not)', () => {
    const original = makeObjective({ id: 'a', createdAt: '2026-07-11T00:00:00.000Z' });
    const key = getPriorityWorkflowKey(original);
    const state: PriorityWorkflowState = { [key]: { completedAt: '2026-07-11T00:00:00.000Z', fingerprint: computeObjectiveFingerprint(original) } };

    const refreshed = makeObjective({ id: 'a-refreshed', createdAt: '2026-07-12T09:00:00.000Z' }); // new id/createdAt, same substance
    const { open, completed, reconciliationChanged } = partitionPriorities([refreshed], state);

    expect(open).toHaveLength(0);
    expect(completed).toHaveLength(1);
    expect(reconciliationChanged).toBe(false);
  });

  it('preserves canonical ordering in open (no re-sorting)', () => {
    const low = makeObjective({ id: 'low', ruleId: 'OBJ-WATCH-POSITION', priority: 'low', subject: { type: 'position', id: 'pos_low', symbol: 'MU', label: 'MU' } });
    const critical = makeObjective({ id: 'critical', ruleId: 'OBJ-CLOSE-LOSER', priority: 'critical', subject: { type: 'position', id: 'pos_crit', symbol: 'NVDA', label: 'NVDA' } });
    const medium = makeObjective({ id: 'medium', ruleId: 'OBJ-MANAGE-21-DTE', priority: 'medium', subject: { type: 'position', id: 'pos_med', symbol: 'MRVL', label: 'MRVL' } });

    // Deliberately NOT priority-sorted -- canonical ordering is whatever
    // Portfolio Intelligence already ranked them as; this function must not
    // touch that order.
    const { open } = partitionPriorities([low, critical, medium], {});
    expect(open.map((o) => o.id)).toEqual(['low', 'critical', 'medium']);
  });

  it('sorts completed newest-first', () => {
    const a = makeObjective({ id: 'a', subject: { type: 'position', id: 'pos_a', symbol: 'AMD', label: 'AMD' } });
    const b = makeObjective({ id: 'b', subject: { type: 'position', id: 'pos_b', symbol: 'NVDA', label: 'NVDA' } });
    const c = makeObjective({ id: 'c', subject: { type: 'position', id: 'pos_c', symbol: 'MU', label: 'MU' } });
    const state: PriorityWorkflowState = {
      [getPriorityWorkflowKey(a)]: { completedAt: '2026-07-10T00:00:00.000Z', fingerprint: computeObjectiveFingerprint(a) },
      [getPriorityWorkflowKey(b)]: { completedAt: '2026-07-12T00:00:00.000Z', fingerprint: computeObjectiveFingerprint(b) },
      [getPriorityWorkflowKey(c)]: { completedAt: '2026-07-11T00:00:00.000Z', fingerprint: computeObjectiveFingerprint(c) },
    };

    const { completed } = partitionPriorities([a, b, c], state);
    expect(completed.map((o) => o.id)).toEqual(['b', 'c', 'a']); // 07-12, 07-11, 07-10
  });

  it('never mutates the input workflowState', () => {
    const objective = makeObjective({ id: 'a' });
    const key = getPriorityWorkflowKey(objective);
    const state: PriorityWorkflowState = { [key]: { completedAt: '2026-07-11T00:00:00.000Z', fingerprint: 'stale-fingerprint' } };
    const snapshot = JSON.stringify(state);

    partitionPriorities([objective], state); // fingerprint mismatch -> would auto-reopen
    expect(JSON.stringify(state)).toBe(snapshot);
  });
});

describe('PI-0004C: markComplete / reopenPriority', () => {
  it('markComplete adds an entry with the current fingerprint', () => {
    const objective = makeObjective({ id: 'a' });
    const next = markComplete({}, objective, new Date('2026-07-12T10:00:00.000Z'));
    const key = getPriorityWorkflowKey(objective);
    expect(next[key]).toEqual({ completedAt: '2026-07-12T10:00:00.000Z', fingerprint: computeObjectiveFingerprint(objective) });
  });

  it('markComplete is a no-op for WAIT (cannot be completed)', () => {
    const wait = makeWait();
    const state: PriorityWorkflowState = {};
    expect(markComplete(state, wait)).toBe(state); // same reference -- genuinely unchanged
  });

  it('reopenPriority removes the stored entry', () => {
    const objective = makeObjective({ id: 'a' });
    const key = getPriorityWorkflowKey(objective);
    const state: PriorityWorkflowState = { [key]: { completedAt: '2026-07-11T00:00:00.000Z', fingerprint: 'x' } };
    const next = reopenPriority(state, objective);
    expect(next[key]).toBeUndefined();
  });

  it('reopenPriority on a key with no entry returns the same reference (no spurious change)', () => {
    const objective = makeObjective({ id: 'a' });
    const state: PriorityWorkflowState = {};
    expect(reopenPriority(state, objective)).toBe(state);
  });
});

describe('PI-0004C: localStorage persistence', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('loadPriorityWorkflowState returns {} when nothing is stored', () => {
    expect(loadPriorityWorkflowState()).toEqual({});
  });

  it('round-trips through save/load', () => {
    const objective = makeObjective({ id: 'a' });
    const state = markComplete({}, objective, new Date('2026-07-12T10:00:00.000Z'));
    savePriorityWorkflowState(state);
    expect(loadPriorityWorkflowState()).toEqual(state);
  });

  it('persists under the documented storage key', () => {
    const state = markComplete({}, makeObjective({ id: 'a' }));
    savePriorityWorkflowState(state);
    expect(localStorage.getItem(PRIORITY_WORKFLOW_STORAGE_KEY)).not.toBeNull();
  });

  it('recovers gracefully from corrupted stored JSON', () => {
    localStorage.setItem(PRIORITY_WORKFLOW_STORAGE_KEY, 'not-json{{{');
    expect(loadPriorityWorkflowState()).toEqual({});
  });
});
