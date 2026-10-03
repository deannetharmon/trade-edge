// lib/discovery/__tests__/candidate.test.ts

import { describe, expect, it } from 'vitest';
import { advanceCandidate, runStrategy, validateTransitionHistory, verifySnapshot } from '..';
import type { CandidateRecord, DiscoveryStrategy } from '..';
import {
  FIXTURE_IDENTITY,
  FIXTURE_IDENTITY_V11,
  T0,
  T1,
  T2,
  createFixtureStrategy,
  makeInput,
  signalFalse,
  signalMissing,
  signalTrue,
} from './fixtures';

const strategy = createFixtureStrategy();

function step(previous: CandidateRecord | null, signal: ReturnType<typeof signalTrue>, asOf: string, s: DiscoveryStrategy = strategy) {
  const input = makeInput(signal, { asOf });
  return advanceCandidate(previous, input, runStrategy(s, input));
}

describe('advanceCandidate', () => {
  it('first observation records a transition from null, pointing at the snapshot that justified it', () => {
    const result = step(null, signalTrue(T0), T0);
    expect(result.record.state).toBe('SETUP');
    expect(result.transition).toMatchObject({ fromState: null, toState: 'SETUP', timestamp: T0, metricSnapshotId: result.snapshot.snapshotId });
    expect(result.transition?.reasonCodes[0].code).toBe('QUALITY_FIXTURE_SIGNAL_PRESENT');
    expect(verifySnapshot(result.snapshot)).toBe(true);
    expect(result.record.lastSnapshotId).toBe(result.snapshot.snapshotId);
    expect(result.snapshot.lifecycleResolution).toMatchObject({ previousState: null, requestedState: 'SETUP', state: 'SETUP', changed: true });
  });

  it('records forward and reverse movement across evaluations', () => {
    const first = step(null, signalTrue(T0), T0);
    const second = step(first.record, signalFalse(T1), T1);
    const third = step(second.record, signalTrue(T2), T2);

    expect(third.record.history.transitions.map((t) => [t.fromState, t.toState])).toEqual([
      [null, 'SETUP'],
      ['SETUP', 'WATCH'],
      ['WATCH', 'SETUP'],
    ]);
    expect(validateTransitionHistory(third.record.history)).toEqual([]);
    // Every transition references a distinct snapshot.
    const ids = third.record.history.transitions.map((t) => t.metricSnapshotId);
    expect(new Set(ids).size).toBe(3);
  });

  it('an unchanged state records a snapshot but no transition', () => {
    const first = step(null, signalTrue(T0), T0);
    const again = step(first.record, signalTrue(T1), T1);
    expect(again.transition).toBeNull();
    expect(again.record.history.transitions).toHaveLength(1);
    expect(again.snapshot.snapshotId).not.toBe(first.snapshot.snapshotId);
    expect(again.record.lastSnapshotId).toBe(again.snapshot.snapshotId);
  });

  it('INSUFFICIENT_DATA never moves an existing candidate, but is still snapshotted', () => {
    const first = step(null, signalTrue(T0), T0);
    const blind = step(first.record, signalMissing(), T1);
    expect(blind.record.state).toBe('SETUP');
    expect(blind.transition).toBeNull();
    expect(blind.snapshot.evaluationOutcome.kind).toBe('INSUFFICIENT_DATA');
    expect(blind.snapshot.candidateState).toBe('SETUP');
  });

  it('a brand-new symbol with INSUFFICIENT_DATA is DISCOVERED', () => {
    const result = step(null, signalMissing(), T0);
    expect(result.record.state).toBe('DISCOVERED');
    expect(result.transition).toMatchObject({ fromState: null, toState: 'DISCOVERED' });
  });

  it('a terminal candidate stays terminal; the later evaluation is still retained', () => {
    const invalidating: DiscoveryStrategy = {
      identity: FIXTURE_IDENTITY,
      evaluate: (input) => ({ ...strategy.evaluate(input), outcome: { kind: 'CLASSIFIED', state: 'INVALIDATED' } }),
    };
    const first = step(null, signalTrue(T0), T0);
    const invalidated = step(first.record, signalFalse(T1), T1, invalidating);
    expect(invalidated.record.state).toBe('INVALIDATED');
    expect(invalidated.transition).toMatchObject({ fromState: 'SETUP', toState: 'INVALIDATED' });

    const later = step(invalidated.record, signalTrue(T2), T2);
    expect(later.record.state).toBe('INVALIDATED');
    expect(later.transition).toBeNull();
    expect(later.blockedByTerminalState).toBe(true);
    expect(later.snapshot.evaluationOutcome).toEqual({ kind: 'CLASSIFIED', state: 'SETUP' });
    expect(later.snapshot.candidateState).toBe('INVALIDATED');
    // Quinn B2: the divergence is explained by the stored snapshot itself, not only by the transient AdvanceResult.
    expect(later.snapshot.lifecycleResolution).toEqual({
      previousState: 'INVALIDATED',
      requestedState: 'SETUP',
      state: 'INVALIDATED',
      changed: false,
      blockedByTerminalState: true,
    });
    expect(verifySnapshot(later.snapshot)).toBe(true);
    expect(later.record.history.transitions).toHaveLength(2);
  });

  it('never mixes strategy versions inside one record', () => {
    const first = step(null, signalTrue(T0), T0);
    const v11 = createFixtureStrategy(FIXTURE_IDENTITY_V11);
    const input = makeInput(signalTrue(T1), { asOf: T1 });
    expect(() => advanceCandidate(first.record, input, runStrategy(v11, input))).toThrow(/tracked under FIX-v1.0/);
  });

  it('never applies an evaluation of one symbol to another symbol\'s record', () => {
    const first = step(null, signalTrue(T0), T0);
    const input = makeInput(signalTrue(T1), { asOf: T1, symbol: 'XYZ' });
    expect(() => advanceCandidate(first.record, input, runStrategy(strategy, input))).toThrow(/cannot absorb/);
  });

  it('does not mutate the previous record', () => {
    const first = step(null, signalTrue(T0), T0);
    const snapshotOfFirst = JSON.stringify(first.record);
    step(first.record, signalFalse(T1), T1);
    expect(JSON.stringify(first.record)).toBe(snapshotOfFirst);
  });
});
