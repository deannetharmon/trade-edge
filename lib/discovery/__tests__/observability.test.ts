// lib/discovery/__tests__/observability.test.ts

import { describe, expect, it } from 'vitest';
import { advanceCandidate, createScanRecorder, runStrategy } from '..';
import type { ScanRecorder, StrategyEvaluation } from '..';
import { FIXTURE_IDENTITY, T0, T1, createFixtureStrategy, makeInput, signalFalse, signalMissing, signalTrue } from './fixtures';

const strategy = createFixtureStrategy();
const END = '2026-10-03T14:00:42.500Z';

function evaluate(signal: ReturnType<typeof signalTrue>, symbol = 'ABC') {
  const input = makeInput(signal, { symbol });
  return { input, evaluation: runStrategy(strategy, input) };
}

function recorder(universeSize: number): ScanRecorder {
  return createScanRecorder({ strategy: FIXTURE_IDENTITY, startedAt: T0, universeSize });
}

function feed(rec: ScanRecorder, ...items: Array<ReturnType<typeof evaluate>>) {
  items.forEach(({ input, evaluation }) => rec.recordEvaluation(evaluation as StrategyEvaluation, input.metrics));
}

describe('scan observability', () => {
  it('records strategy, universe, duration, gate counts, metric validity and candidate-state counts', () => {
    const rec = recorder(4);
    feed(rec, evaluate(signalTrue(), 'AAA'), evaluate(signalFalse(), 'BBB'), evaluate(signalTrue(), 'CCC'), evaluate(signalMissing(), 'DDD'));
    rec.recordApiCalls('fundamentals', 3);
    rec.recordApiCalls('fundamentals', 2);

    const summary = rec.finalize(END);
    expect(summary).toMatchObject({
      strategy: FIXTURE_IDENTITY,
      universeSize: 4,
      evaluatedCount: 4,
      insufficientDataCount: 1,
      durationMs: 42500,
      apiCalls: { fundamentals: 5 },
      gateCounts: { fixture_gate: { PASS: 2, FAIL: 1, NOT_EVALUABLE: 1 } },
      metricValidityCounts: { VALID: 3, UNAVAILABLE: 1, STALE: 0, INVALID: 0 },
    });
    expect(summary.candidateStateCounts).toEqual({ DISCOVERED: 0, WATCH: 1, SETUP: 2, ACTIONABLE: 0, INVALIDATED: 0, EXPIRED: 0 });
  });

  it('counts invalidation transitions', () => {
    const rec = recorder(1);
    const { input, evaluation } = evaluate(signalTrue());
    const invalidating = { ...evaluation, outcome: { kind: 'CLASSIFIED' as const, state: 'INVALIDATED' as const } };
    const first = advanceCandidate(null, input, evaluation);
    const second = advanceCandidate(first.record, input, invalidating);
    [first.transition, second.transition].forEach((t) => t && rec.recordTransition(t));
    expect(rec.finalize(END).invalidationTransitionCount).toBe(1);
  });

  it('a clean scan that finds nothing says NO_CANDIDATES -- a genuine "nothing found"', () => {
    const rec = recorder(0 + 2);
    const nothing = (symbol: string) => {
      const { input, evaluation } = evaluate(signalTrue(), symbol);
      return { input, evaluation: { ...evaluation, outcome: { kind: 'CLASSIFIED' as const, state: 'DISCOVERED' as const } } };
    };
    feed(rec, nothing('AAA'), nothing('BBB'));
    expect(rec.finalize(END)).toMatchObject({ health: 'HEALTHY', opportunityOutcome: 'NO_CANDIDATES', healthReasons: [] });
  });

  it('a scan that evaluated nothing is FAILED / NOT_DETERMINED, never "no opportunities"', () => {
    const rec = recorder(50);
    rec.recordProviderFailure('fundamentals', 'HTTP 503');
    const summary = rec.finalize(END);
    expect(summary.health).toBe('FAILED');
    expect(summary.opportunityOutcome).toBe('NOT_DETERMINED');
    expect(summary.healthReasons).toContain('NO_SYMBOL_EVALUATED');
    expect(summary.providerFailures).toEqual([{ scope: 'fundamentals', detail: 'HTTP 503' }]);
  });

  it('an empty universe or an explicit fatal error is FAILED', () => {
    expect(recorder(0).finalize(END)).toMatchObject({ health: 'FAILED', opportunityOutcome: 'NOT_DETERMINED' });
    const rec = recorder(3);
    feed(rec, evaluate(signalTrue()));
    rec.recordFatal('universe load aborted');
    expect(rec.finalize(END)).toMatchObject({ health: 'FAILED', fatalReason: 'universe load aborted' });
  });

  it('partial failures are DEGRADED; with no candidates the outcome cannot claim that nothing exists', () => {
    const rec = recorder(3);
    const none = (symbol: string) => {
      const { input, evaluation } = evaluate(signalTrue(), symbol);
      return { input, evaluation: { ...evaluation, outcome: { kind: 'CLASSIFIED' as const, state: 'DISCOVERED' as const } } };
    };
    feed(rec, none('AAA'), none('BBB'));
    rec.recordEvaluationError('CCC', 'boom');
    rec.recordOptionChainFailure('AAA', 'chain timeout');
    const summary = rec.finalize(END);
    expect(summary).toMatchObject({
      health: 'DEGRADED',
      opportunityOutcome: 'NO_CANDIDATES_AMONG_EVALUATED',
      evaluationErrorCount: 1,
    });
    expect(summary.healthReasons).toEqual(['EVALUATION_ERRORS:1', 'OPTION_CHAIN_FAILURES:1', 'UNEVALUATED_SYMBOLS:1']);
    expect(summary.optionChainFailures).toEqual([{ scope: 'AAA', detail: 'chain timeout' }]);
  });

  it('INSUFFICIENT_DATA alone keeps a candidate-free scan from claiming "nothing exists"', () => {
    const rec = recorder(1);
    feed(rec, evaluate(signalMissing()));
    expect(rec.finalize(END)).toMatchObject({ health: 'HEALTHY', opportunityOutcome: 'NO_CANDIDATES_AMONG_EVALUATED', insufficientDataCount: 1 });
  });

  it('degraded scans that still find candidates report CANDIDATES_FOUND', () => {
    const rec = recorder(2);
    feed(rec, evaluate(signalTrue()));
    rec.recordProviderFailure('estimates', 'timeout');
    expect(rec.finalize(END)).toMatchObject({ health: 'DEGRADED', opportunityOutcome: 'CANDIDATES_FOUND' });
  });

  it('produces an immutable summary and validates its inputs', () => {
    const summary = recorder(1).finalize(END);
    expect(Object.isFrozen(summary)).toBe(true);
    expect(() => recorder(1).finalize(T0.replace('14', '13'))).toThrow(/precedes/);
    expect(() => recorder(1).finalize('later')).toThrow(/ISO-8601/);
    expect(() => createScanRecorder({ strategy: FIXTURE_IDENTITY, startedAt: T1, universeSize: -1 })).toThrow(/universeSize/);
    expect(() => recorder(1).recordApiCalls('x', -1)).toThrow(/non-negative/);
  });
});
