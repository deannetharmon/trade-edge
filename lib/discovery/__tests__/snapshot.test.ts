// lib/discovery/__tests__/snapshot.test.ts

import { describe, expect, it } from 'vitest';
import { computeSnapshotId, createCandidateSnapshot, runStrategy, snapshotIdentity, verifySnapshot } from '..';
import { FIXTURE_IDENTITY, T0, T1, createFixtureStrategy, makeInput, signalFalse, signalMissing, signalTrue } from './fixtures';

const strategy = createFixtureStrategy();

function snapshotFor(signal = signalTrue(), state: Parameters<typeof createCandidateSnapshot>[2] = 'SETUP') {
  const input = makeInput(signal);
  return createCandidateSnapshot(input, runStrategy(strategy, input), state);
}

describe('candidate snapshot', () => {
  it('captures the strategy, timestamp, underlying, price, metrics with validity, gates, reasons, state, rankings and completeness', () => {
    const snapshot = snapshotFor();
    expect(snapshot).toMatchObject({
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
    const snapshot = createCandidateSnapshot(input, runStrategy(strategy, input), 'SETUP', {
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
    expect(snapshotFor().snapshotId).toMatch(/^snap_[0-9a-f]{14}$/);
    expect(snapshotFor(signalFalse(), 'WATCH').snapshotId).not.toBe(snapshotFor().snapshotId);
    expect(snapshotFor(signalTrue(), 'ACTIONABLE').snapshotId).not.toBe(snapshotFor(signalTrue(), 'SETUP').snapshotId);

    const input = makeInput(signalTrue(), { asOf: T1, symbol: 'ABC' });
    const later = createCandidateSnapshot(input, runStrategy(strategy, input), 'SETUP');
    expect(later.snapshotId).not.toBe(snapshotFor().snapshotId);
  });

  it('verifySnapshot detects content that no longer matches its id', () => {
    const snapshot = snapshotFor();
    expect(verifySnapshot(snapshot)).toBe(true);
    const tampered = { ...snapshot, candidateState: 'ACTIONABLE' as const };
    expect(verifySnapshot(tampered)).toBe(false);
    const { snapshotId, ...content } = snapshot;
    expect(computeSnapshotId(content)).toBe(snapshotId);
  });

  it('retains unflattering cases: insufficient-data and terminal-state evaluations are snapshotted too', () => {
    const insufficient = snapshotFor(signalMissing(), 'DISCOVERED');
    expect(insufficient.evaluationOutcome).toMatchObject({ kind: 'INSUFFICIENT_DATA' });
    expect(insufficient.metrics.fixture_signal.validity).toBe('UNAVAILABLE');
    expect(insufficient.reasonCodes[0].code).toBe('DATA_FIXTURE_SIGNAL_UNAVAILABLE');

    const invalidated = snapshotFor(signalFalse(), 'INVALIDATED');
    expect(invalidated.candidateState).toBe('INVALIDATED');
  });

  it('refuses an evaluation that belongs to a different input', () => {
    const input = makeInput(signalTrue());
    const other = makeInput(signalTrue(), { symbol: 'XYZ' });
    expect(() => createCandidateSnapshot(other, runStrategy(strategy, input), 'SETUP')).toThrow(/does not belong/);
  });
});
