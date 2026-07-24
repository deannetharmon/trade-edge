// lib/revalidation/__tests__/revalidateCommitment.test.ts
//
// MB-0001B: coverage for the Revalidation Engine's core contract --
// silence when nothing material changed, a structured change (what/why/why
// now) when it did, honest handling of missing context, and the two
// intentionally-unregistered commitment kinds staying silent rather than
// fabricating a signal. Fixtures build real PortfolioObjective/
// TraderCommitment shapes directly (no `as any` casts), following the same
// pattern as lib/todaysPriorities/__tests__/explanation.test.ts and
// lib/morning-briefing/__tests__/attentionFeed.test.ts.

import { describe, expect, it } from 'vitest';
import { revalidateCommitment, revalidateCommitments } from '../revalidateCommitment';
import type { RevalidationContext } from '../types';
import { createTraderCommitment } from '@/lib/trader-commitments';
import type { TraderCommitmentSubject } from '@/lib/trader-commitments';
import type { PortfolioObjective } from '@/lib/portfolio-intelligence';

const SUBJECT: TraderCommitmentSubject = { type: 'position', id: 'pos_1', symbol: 'AAPL', label: 'AAPL BPS' };
const NOW = new Date('2026-07-25T09:00:00.000Z');
const NOW_ISO = NOW.toISOString();

function makeObjective(overrides: Partial<PortfolioObjective> = {}): PortfolioObjective {
  return {
    id: 'obj_1',
    createdAt: NOW_ISO,
    version: 'portfolio-objective-v1',
    type: 'MANAGE_POSITION',
    ruleId: 'OBJ-WATCH-POSITION',
    title: 'Hold Position: AAPL',
    summary: 'Test summary.',
    priority: 'medium',
    urgency: 'monitor',
    actionability: 'MONITOR',
    confidence: 80,
    status: 'active',
    source: 'position',
    subject: { type: 'position', id: 'pos_1', symbol: 'AAPL', label: 'AAPL position' },
    rationale: 'Hold the position.',
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

function emptyContext(overrides: Partial<RevalidationContext> = {}): RevalidationContext {
  return { now: NOW_ISO, objective: null, position: null, ...overrides };
}

describe('revalidateCommitment: HOLD_UNTIL_DTE', () => {
  it('is silent when the current DTE is still above the target', () => {
    const commitment = createTraderCommitment({ kind: 'HOLD_UNTIL_DTE', subject: SUBJECT, targetDte: 21 }, NOW);
    const result = revalidateCommitment(commitment, emptyContext({ position: { dte: 30 } }));

    expect(result.changed).toBe(false);
    expect(result.change).toBeNull();
  });

  it('reports a change once DTE reaches the target', () => {
    const commitment = createTraderCommitment({ kind: 'HOLD_UNTIL_DTE', subject: SUBJECT, targetDte: 21 }, NOW);
    const result = revalidateCommitment(commitment, emptyContext({ position: { dte: 21 } }));

    expect(result.changed).toBe(true);
    expect(result.change?.whatChanged).toContain('21 DTE');
    expect(result.change?.whyItMatters.length).toBeGreaterThan(0);
    expect(result.change?.whyNow.length).toBeGreaterThan(0);
  });

  it('reports a change once DTE has passed the target', () => {
    const commitment = createTraderCommitment({ kind: 'HOLD_UNTIL_DTE', subject: SUBJECT, targetDte: 21 }, NOW);
    const result = revalidateCommitment(commitment, emptyContext({ position: { dte: 10 } }));

    expect(result.changed).toBe(true);
  });

  it('stays silent (does not fabricate a change) when position context is missing entirely', () => {
    const commitment = createTraderCommitment({ kind: 'HOLD_UNTIL_DTE', subject: SUBJECT, targetDte: 21 }, NOW);
    const result = revalidateCommitment(commitment, emptyContext({ position: null }));

    expect(result.changed).toBe(false);
    expect(result.change).toBeNull();
  });
});

describe('revalidateCommitment: WAIT_FOR_EARNINGS', () => {
  it('is silent when the objective has no earnings review trigger', () => {
    const commitment = createTraderCommitment({ kind: 'WAIT_FOR_EARNINGS', subject: SUBJECT }, NOW);
    const objective = makeObjective({ reviewTriggers: [] });
    const result = revalidateCommitment(commitment, emptyContext({ objective }));

    expect(result.changed).toBe(false);
  });

  it('reports a change once the objective carries an earnings review trigger', () => {
    const commitment = createTraderCommitment({ kind: 'WAIT_FOR_EARNINGS', subject: SUBJECT }, NOW);
    const objective = makeObjective({
      reviewTriggers: [{ id: 'trig_earnings', label: 'Earnings', triggerType: 'earnings', explanation: 'Earnings before expiration.' }],
    });
    const result = revalidateCommitment(commitment, emptyContext({ objective }));

    expect(result.changed).toBe(true);
    expect(result.change?.whatChanged).toContain('earnings');
  });

  it('stays silent when there is no objective at all for the subject', () => {
    const commitment = createTraderCommitment({ kind: 'WAIT_FOR_EARNINGS', subject: SUBJECT }, NOW);
    const result = revalidateCommitment(commitment, emptyContext({ objective: null }));

    expect(result.changed).toBe(false);
  });
});

describe('revalidateCommitment: MONITOR indefinite acknowledgment (reviewAfter: null)', () => {
  it('never reports a change regardless of context, by design', () => {
    const commitment = createTraderCommitment({ kind: 'MONITOR', subject: SUBJECT }, NOW);
    const objective = makeObjective({
      reviewTriggers: [{ id: 'trig_earnings', label: 'Earnings', triggerType: 'earnings', explanation: '' }],
    });
    const result = revalidateCommitment(commitment, emptyContext({ objective, position: { dte: 1 } }));

    expect(result.changed).toBe(false);
    expect(result.change).toBeNull();
  });
});

describe('revalidateCommitment: MONITOR active monitoring with an explicit re-review condition', () => {
  it('stays silent before the reviewAfter date arrives', () => {
    const commitment = createTraderCommitment(
      { kind: 'MONITOR', subject: SUBJECT, reviewAfter: '2026-08-15T00:00:00.000Z' },
      NOW,
    );
    const result = revalidateCommitment(commitment, emptyContext({ now: '2026-08-01T00:00:00.000Z' }));

    expect(result.changed).toBe(false);
    expect(result.change).toBeNull();
  });

  it('reports a re-review-due change once now reaches the reviewAfter date exactly', () => {
    const commitment = createTraderCommitment(
      { kind: 'MONITOR', subject: SUBJECT, reviewAfter: '2026-08-15T00:00:00.000Z' },
      NOW,
    );
    const result = revalidateCommitment(commitment, emptyContext({ now: '2026-08-15T00:00:00.000Z' }));

    expect(result.changed).toBe(true);
    expect(result.change?.whatChanged).toContain('re-review');
    expect(result.change?.whyItMatters.length).toBeGreaterThan(0);
    expect(result.change?.whyNow.length).toBeGreaterThan(0);
  });

  it('reports a re-review-due change once now has passed the reviewAfter date', () => {
    const commitment = createTraderCommitment(
      { kind: 'MONITOR', subject: SUBJECT, reviewAfter: '2026-08-15T00:00:00.000Z' },
      NOW,
    );
    const result = revalidateCommitment(commitment, emptyContext({ now: '2026-09-01T00:00:00.000Z' }));

    expect(result.changed).toBe(true);
  });

  it('re-entry: re-review fires again on a fresh call once the date has passed, matching the "condition met" contract other rules already provide', () => {
    const commitment = createTraderCommitment(
      { kind: 'MONITOR', subject: SUBJECT, reviewAfter: '2026-08-15T00:00:00.000Z' },
      NOW,
    );

    const before = revalidateCommitment(commitment, emptyContext({ now: '2026-08-01T00:00:00.000Z' }));
    const atCondition = revalidateCommitment(commitment, emptyContext({ now: '2026-08-15T00:00:00.000Z' }));

    expect(before.changed).toBe(false);
    expect(atCondition.changed).toBe(true);
  });

  it('is unaffected by objective/position context -- the re-review condition is date-only', () => {
    const commitment = createTraderCommitment(
      { kind: 'MONITOR', subject: SUBJECT, reviewAfter: '2026-08-15T00:00:00.000Z' },
      NOW,
    );
    const objective = makeObjective({ reviewTriggers: [] });
    const result = revalidateCommitment(
      commitment,
      emptyContext({ now: '2026-09-01T00:00:00.000Z', objective, position: { dte: 5 } }),
    );

    expect(result.changed).toBe(true);
  });
});

describe('revalidateCommitment: unregistered commitment kinds', () => {
  it('LET_THETA_WORK has no registered rule and stays silent rather than fabricating a signal', () => {
    const commitment = createTraderCommitment({ kind: 'LET_THETA_WORK', subject: SUBJECT }, NOW);
    const result = revalidateCommitment(commitment, emptyContext());

    expect(result.changed).toBe(false);
    expect(result.change).toBeNull();
  });

  it('GTC_WORKING has no registered rule and stays silent rather than fabricating a signal', () => {
    const commitment = createTraderCommitment({ kind: 'GTC_WORKING', subject: SUBJECT, orderId: 'order_1' }, NOW);
    const result = revalidateCommitment(commitment, emptyContext());

    expect(result.changed).toBe(false);
    expect(result.change).toBeNull();
  });
});

describe('revalidateCommitments (batch)', () => {
  it('revalidates each commitment against its own context', () => {
    const stale = createTraderCommitment({ kind: 'HOLD_UNTIL_DTE', subject: SUBJECT, targetDte: 21 }, NOW);
    const fresh = createTraderCommitment(
      { kind: 'HOLD_UNTIL_DTE', subject: { ...SUBJECT, id: 'pos_2', symbol: 'MSFT', label: 'MSFT BPS' }, targetDte: 21 },
      NOW,
    );
    const contextFor = (commitment: typeof stale) =>
      emptyContext({ position: { dte: commitment.subject.id === 'pos_1' ? 10 : 45 } });

    const results = revalidateCommitments([stale, fresh], contextFor);

    expect(results).toHaveLength(2);
    expect(results[0].changed).toBe(true);
    expect(results[1].changed).toBe(false);
  });
});

describe('revalidateCommitment: determinism', () => {
  it('produces deeply equal results across repeated calls with identical input', () => {
    const commitment = createTraderCommitment({ kind: 'HOLD_UNTIL_DTE', subject: SUBJECT, targetDte: 21 }, NOW);
    const context = emptyContext({ position: { dte: 21 } });

    const first = revalidateCommitment(commitment, context);
    const second = revalidateCommitment(commitment, context);

    expect(second).toEqual(first);
  });
});
