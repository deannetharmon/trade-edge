// lib/discovery/__tests__/transitions.test.ts

import { describe, expect, it } from 'vitest';
import {
  appendTransition,
  countTransitionsTo,
  createReason,
  createTransitionHistory,
  currentStateOf,
  validateTransitionHistory,
} from '..';
import type { TransitionHistory } from '..';
import { FIXTURE_IDENTITY, FIXTURE_IDENTITY_V11, T0, T1, T2 } from './fixtures';

const reasons = [createReason({ code: 'LIFECYCLE_FIXTURE_REASON', polarity: 'INFORMATIONAL' })];
const request = (toState: Parameters<typeof appendTransition>[1]['toState'], timestamp: string, snap = 'snap_1') => ({
  toState,
  timestamp,
  strategy: FIXTURE_IDENTITY,
  metricSnapshotId: snap,
  reasonCodes: reasons,
});

describe('state-transition history', () => {
  it('starts empty and uppercases the symbol', () => {
    const history = createTransitionHistory(' abc ', FIXTURE_IDENTITY);
    expect(history.symbol).toBe('ABC');
    expect(currentStateOf(history)).toBeNull();
  });

  it('records fromState, toState, timestamp, strategy, version, snapshot id and reason codes', () => {
    let history = createTransitionHistory('ABC', FIXTURE_IDENTITY);
    history = appendTransition(history, request('DISCOVERED', T0, 'snap_a'));
    history = appendTransition(history, request('WATCH', T1, 'snap_b'));

    expect(history.transitions).toEqual([
      {
        fromState: null,
        toState: 'DISCOVERED',
        timestamp: T0,
        strategyId: 'FIX',
        strategyVersion: 'FIX-v1.0',
        metricSnapshotId: 'snap_a',
        reasonCodes: reasons,
      },
      {
        fromState: 'DISCOVERED',
        toState: 'WATCH',
        timestamp: T1,
        strategyId: 'FIX',
        strategyVersion: 'FIX-v1.0',
        metricSnapshotId: 'snap_b',
        reasonCodes: reasons,
      },
    ]);
    expect(currentStateOf(history)).toBe('WATCH');
  });

  it('is append-only: appending returns a new frozen history and leaves the old one untouched', () => {
    const empty = createTransitionHistory('ABC', FIXTURE_IDENTITY);
    const one = appendTransition(empty, request('WATCH', T0));
    expect(empty.transitions).toHaveLength(0);
    expect(one.transitions).toHaveLength(1);
    expect(Object.isFrozen(one)).toBe(true);
    expect(Object.isFrozen(one.transitions)).toBe(true);
    expect(() => (one.transitions as unknown as unknown[]).push({})).toThrow();
  });

  it('records reverse transitions', () => {
    let history = createTransitionHistory('ABC', FIXTURE_IDENTITY);
    history = appendTransition(history, request('ACTIONABLE', T0));
    history = appendTransition(history, request('SETUP', T1));
    history = appendTransition(history, request('WATCH', T2));
    expect(history.transitions.map((t) => t.toState)).toEqual(['ACTIONABLE', 'SETUP', 'WATCH']);
  });

  it('rejects disallowed, self, out-of-order, unexplained and mis-versioned transitions', () => {
    const base = appendTransition(createTransitionHistory('ABC', FIXTURE_IDENTITY), request('WATCH', T1));
    expect(() => appendTransition(base, request('WATCH', T2))).toThrow(/not allowed/);
    expect(() => appendTransition(base, request('SETUP', T0))).toThrow(/precedes/);
    expect(() => appendTransition(base, { ...request('SETUP', T2), reasonCodes: [] })).toThrow(/reason code/);
    expect(() => appendTransition(base, { ...request('SETUP', T2), metricSnapshotId: '' })).toThrow(/snapshot/);
    expect(() => appendTransition(base, { ...request('SETUP', 'soon') })).toThrow(/ISO-8601/);
    expect(() => appendTransition(base, { ...request('SETUP', T2), strategy: FIXTURE_IDENTITY_V11 })).toThrow(/does not match/);
    expect(() => appendTransition(createTransitionHistory('ABC', FIXTURE_IDENTITY), request('INVALIDATED', T0))).toThrow(/not allowed/);
  });

  it('keeps history after a terminal state and refuses to leave it', () => {
    let history = createTransitionHistory('ABC', FIXTURE_IDENTITY);
    history = appendTransition(history, request('SETUP', T0));
    history = appendTransition(history, request('INVALIDATED', T1));
    expect(history.transitions).toHaveLength(2);
    expect(countTransitionsTo(history, 'INVALIDATED')).toBe(1);
    expect(() => appendTransition(history, request('WATCH', T2))).toThrow(/not allowed/);
  });
});

describe('validateTransitionHistory (for data loaded from storage)', () => {
  const good = appendTransition(
    appendTransition(createTransitionHistory('ABC', FIXTURE_IDENTITY), request('DISCOVERED', T0)),
    request('SETUP', T1),
  );

  it('accepts a history built through appendTransition', () => {
    expect(validateTransitionHistory(good)).toEqual([]);
  });

  it('detects a broken chain, a disallowed move, bad ordering, a foreign strategy and missing evidence', () => {
    const tampered: TransitionHistory = {
      ...good,
      transitions: [
        { ...good.transitions[0], fromState: 'WATCH' },
        { ...good.transitions[1], timestamp: '2020-01-01T00:00:00.000Z', strategyVersion: 'FIX-v9.9', metricSnapshotId: '', reasonCodes: [] },
      ],
    };
    const problems = validateTransitionHistory(tampered).join('\n');
    expect(problems).toMatch(/transition #0: fromState WATCH does not continue from null/);
    expect(problems).toMatch(/transition #1: timestamp precedes/);
    expect(problems).toMatch(/transition #1: strategy identity differs/);
    expect(problems).toMatch(/transition #1: missing metricSnapshotId/);
    expect(problems).toMatch(/transition #1: no reason codes/);
  });
});
