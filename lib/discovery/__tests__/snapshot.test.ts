// lib/discovery/__tests__/snapshot.test.ts

import { describe, expect, it } from 'vitest';
import { classified, computeSnapshotId, createCandidateSnapshot, resolveNextState, runStrategy, snapshotIdentity, verifySnapshot } from '..';
import type { CandidateState } from '..';
import { FIXTURE_IDENTITY, T0, T1, createFixtureStrategy, makeInput, signalFalse, signalMissing, signalTrue } from './fixtures';

const strategy = createFixtureStrategy();

/** `previous` is the candidate's state before this evaluation (null = first observation). */
function snapshotFor(signal = signalTrue(), previous: CandidateState | null = null) {
  const input = makeInput(signal);
  const evaluation = runStrategy(strategy, input);
  return createCandidateSnapshot(input, evaluation, resolveNextState(previous, evaluation.outcome));
}

describe('candidate snapshot', () => {
  it('captures the strategy, timestamp, underlying, price, metrics with validity, gates, reasons, state, rankings and completeness', () => {
    const snapshot = snapshotFor();
    expect(snapshot).toMatchObject({
      lifecycleResolution: { previousState: null, requestedState: 'SETUP', state: 'SETUP', changed: true, blockedByTerminalState: false },
      strategyId: 'FIX',
      strategyVersion: 'FIX-v1.0',
      capturedAt: T0,
      symbol: 'ABC',
      candidateState: 'SETUP',
      underlyingPrice: { id: 'underlying_price', validity: 'VALID', value: 100 },
      metrics: { fixture_signal: { validity: 'VALID', value: true } },
      evaluationOutcome: { kind: 'CLASSIFIED', state: 'SETUP' },
      rankings: {},
      riskFlags: [],
      selectedContract: null,
      contractMarketData: null,
      scenarios: [],
    });
    expect(snapshot.gateOutcomes[0]).toMatchObject({ gateId: 'fixture_gate', result: 'PASS' });
    expect(snapshot.reasonCodes[0].code).toBe('QUALITY_FIXTURE_SIGNAL_PRESENT');
    expect(snapshot.dataCompleteness.complete).toBe(true);
    expect(snapshotIdentity(snapshot)).toEqual(FIXTURE_IDENTITY);
  });

  it('carries contract and scenario payloads supplied by later gates', () => {
    const input = makeInput(signalTrue());
    const evaluation = runStrategy(strategy, input);
    const snapshot = createCandidateSnapshot(input, evaluation, resolveNextState(null, evaluation.outcome), {
      selectedContract: { strike: 90, expiration: '2028-01-21' },
      contractMarketData: { bid: 10.1, ask: 10.4 },
      scenarios: [{ name: 'base', stockPrice: 120 }],
    });
    expect(snapshot.selectedContract).toEqual({ strike: 90, expiration: '2028-01-21' });
    expect(snapshot.contractMarketData).toEqual({ bid: 10.1, ask: 10.4 });
    expect(snapshot.scenarios).toEqual([{ name: 'base', stockPrice: 120 }]);
  });

  it('is immutable', () => {
    const snapshot = snapshotFor();
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.reasonCodes)).toBe(true);
    expect(() => {
      (snapshot as unknown as { candidateState: string }).candidateState = 'ACTIONABLE';
    }).toThrow();
  });

  it('the id is a content fingerprint: identical evidence -> identical id; any change -> different id', () => {
    expect(snapshotFor().snapshotId).toBe(snapshotFor().snapshotId);
    // 256-bit fingerprint (Quinn Gate 1 review S1): 64 hex characters.
    expect(snapshotFor().snapshotId).toMatch(/^snap_[0-9a-f]{64}$/);
    expect(snapshotFor(signalFalse()).snapshotId).not.toBe(snapshotFor().snapshotId);
    // Same evidence, different lifecycle history -> different snapshot.
    expect(snapshotFor(signalTrue(), 'WATCH').snapshotId).not.toBe(snapshotFor(signalTrue(), null).snapshotId);

    const input = makeInput(signalTrue(), { asOf: T1, symbol: 'ABC' });
    const laterEvaluation = runStrategy(strategy, input);
    const later = createCandidateSnapshot(input, laterEvaluation, resolveNextState(null, laterEvaluation.outcome));
    expect(later.snapshotId).not.toBe(snapshotFor().snapshotId);
  });

  it('verifySnapshot detects content that no longer matches its id', () => {
    const snapshot = snapshotFor();
    expect(verifySnapshot(snapshot)).toBe(true);
    const tampered = { ...snapshot, candidateState: 'ACTIONABLE' as const };
    expect(verifySnapshot(tampered)).toBe(false);
    // A forged resolution is caught even when the id is recomputed to match.
    const forged = { ...snapshot, candidateState: 'ACTIONABLE' as const, lifecycleResolution: { ...snapshot.lifecycleResolution, state: 'ACTIONABLE' as const } };
    const { snapshotId: _ignored, ...forgedContent } = forged;
    expect(verifySnapshot({ ...forged, snapshotId: computeSnapshotId(forgedContent) })).toBe(false);
    const { snapshotId, ...content } = snapshot;
    expect(computeSnapshotId(content)).toBe(snapshotId);
  });

  it('retains unflattering cases: insufficient-data and terminal-state evaluations are snapshotted too', () => {
    const insufficient = snapshotFor(signalMissing());
    expect(insufficient.evaluationOutcome).toMatchObject({ kind: 'INSUFFICIENT_DATA' });
    expect(insufficient.lifecycleResolution).toMatchObject({ requestedState: null, state: 'DISCOVERED' });
    expect(insufficient.metrics.fixture_signal.validity).toBe('UNAVAILABLE');
    expect(insufficient.reasonCodes[0].code).toBe('DATA_FIXTURE_SIGNAL_UNAVAILABLE');

    const invalidated = snapshotFor(signalFalse(), 'INVALIDATED');
    expect(invalidated.candidateState).toBe('INVALIDATED');
  });

  it('records WHY a terminal candidate kept its state although the evaluation said otherwise (Quinn B2)', () => {
    const blocked = snapshotFor(signalTrue(), 'INVALIDATED'); // evidence now says SETUP
    expect(blocked.evaluationOutcome).toEqual({ kind: 'CLASSIFIED', state: 'SETUP' });
    expect(blocked.candidateState).toBe('INVALIDATED');
    expect(blocked.lifecycleResolution).toEqual({
      previousState: 'INVALIDATED',
      requestedState: 'SETUP',
      state: 'INVALIDATED',
      changed: false,
      blockedByTerminalState: true,
    });
    expect(verifySnapshot(blocked)).toBe(true);

    // The same terminal state with an agreeing evaluation is a different, unblocked record.
    const agreeing = snapshotFor(signalFalse(), 'INVALIDATED');
    expect(agreeing.lifecycleResolution.blockedByTerminalState).toBe(true); // WATCH requested, still blocked
    const same = createCandidateSnapshot(makeInput(signalFalse()), { ...runStrategy(strategy, makeInput(signalFalse())), outcome: classified('INVALIDATED') }, resolveNextState('INVALIDATED', classified('INVALIDATED')));
    expect(same.lifecycleResolution.blockedByTerminalState).toBe(false);
    expect(same.snapshotId).not.toBe(blocked.snapshotId);
  });

  it('refuses a lifecycle resolution that is inconsistent or does not belong to the evaluation', () => {
    const input = makeInput(signalTrue());
    const evaluation = runStrategy(strategy, input);
    const good = resolveNextState(null, evaluation.outcome);
    expect(() => createCandidateSnapshot(input, evaluation, { ...good, state: 'ACTIONABLE' })).toThrow(/Inconsistent lifecycle resolution/);
    expect(() => createCandidateSnapshot(input, evaluation, { ...good, blockedByTerminalState: true })).toThrow(/Inconsistent lifecycle resolution/);
    // Quinn B3: a first observation cannot be a terminal state, so neither a new snapshot nor a stored one may claim it.
    const terminalEvaluation = { ...evaluation, outcome: classified('INVALIDATED') };
    const forged = { previousState: null, requestedState: 'INVALIDATED' as const, state: 'INVALIDATED' as const, changed: true, blockedByTerminalState: false };
    expect(() => createCandidateSnapshot(input, terminalEvaluation, forged)).toThrow(/null -> INVALIDATED is not an allowed transition/);

    const genuine = snapshotFor();
    const stored = { ...genuine, candidateState: 'INVALIDATED' as const, evaluationOutcome: classified('INVALIDATED'), lifecycleResolution: forged };
    const { snapshotId: _old, ...storedContent } = stored;
    expect(verifySnapshot({ ...stored, snapshotId: computeSnapshotId(storedContent) })).toBe(false);

    // Internally consistent, but for a different evaluation outcome.
    const other = resolveNextState(null, classified('WATCH'));
    expect(() => createCandidateSnapshot(input, evaluation, other)).toThrow(/does not match the evaluation outcome/);
  });

  it('refuses an evaluation that belongs to a different input', () => {
    const input = makeInput(signalTrue());
    const other = makeInput(signalTrue(), { symbol: 'XYZ' });
    expect(() => createCandidateSnapshot(other, runStrategy(strategy, input), resolveNextState(null, classified('SETUP')))).toThrow(/does not belong/);
  });
});
