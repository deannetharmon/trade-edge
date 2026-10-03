// lib/discovery/__tests__/evaluation.test.ts

import { describe, expect, it } from 'vitest';
import { StrategyContractError, createReason, createStrategyInput, explainReason, runStrategy, unavailableMetric, validMetric } from '..';
import type { DiscoveryStrategy, MetricSet, StrategyEvaluation } from '..';
import {
  FIXTURE_IDENTITY,
  FIXTURE_IDENTITY_V11,
  T0,
  T1,
  createFixtureStrategy,
  makeInput,
  priceMetric,
  signalFalse,
  signalMissing,
  signalTrue,
} from './fixtures';

describe('strategy input contract', () => {
  it('normalizes the symbol and requires an ISO timestamp', () => {
    const input = makeInput(signalTrue(), { symbol: ' abc ' });
    expect(input.symbol).toBe('ABC');
    expect(() =>
      createStrategyInput({ symbol: 'ABC', asOf: 'today', underlyingPrice: priceMetric(), metrics: {} }),
    ).toThrow(/ISO-8601/);
  });

  it('rejects a metric set whose keys disagree with the metric ids', () => {
    const metrics: MetricSet = { wrong_key: validMetric('other_id', 1, T0) };
    expect(() => createStrategyInput({ symbol: 'ABC', asOf: T0, underlyingPrice: priceMetric(), metrics })).toThrow(/does not match/);
  });
});

describe('runStrategy', () => {
  const strategy = createFixtureStrategy();

  it('returns a frozen evaluation labelled with the strategy id and version', () => {
    const evaluation = runStrategy(strategy, makeInput(signalTrue()));
    expect(evaluation.identity).toEqual(FIXTURE_IDENTITY);
    expect(evaluation.outcome).toEqual({ kind: 'CLASSIFIED', state: 'SETUP' });
    expect(Object.isFrozen(evaluation)).toBe(true);
    expect(Object.isFrozen(evaluation.reasonCodes)).toBe(true);
  });

  it('is deterministic: equal input -> deeply equal evaluation, any number of runs', () => {
    const first = runStrategy(strategy, makeInput(signalTrue()));
    for (let i = 0; i < 5; i += 1) {
      expect(runStrategy(strategy, makeInput(signalTrue()))).toEqual(first);
    }
  });

  it('missing evidence is INSUFFICIENT_DATA with a data-limitation reason -- not a fail, not a pass', () => {
    const evaluation = runStrategy(strategy, makeInput(signalMissing()));
    expect(evaluation.outcome).toEqual({ kind: 'INSUFFICIENT_DATA', missingMetricIds: ['fixture_signal'] });
    expect(evaluation.gateOutcomes[0].result).toBe('NOT_EVALUABLE');
    expect(evaluation.reasonCodes.map((r) => r.code)).toEqual(['DATA_FIXTURE_SIGNAL_UNAVAILABLE']);
    expect(evaluation.dataCompleteness).toMatchObject({ complete: false, criticalComplete: false, criticalMissing: ['fixture_signal'] });
  });

  it('a failed criterion stays distinct from an unevaluable one', () => {
    const failed = runStrategy(strategy, makeInput(signalFalse()));
    expect(failed.gateOutcomes[0].result).toBe('FAIL');
    expect(failed.outcome).toEqual({ kind: 'CLASSIFIED', state: 'WATCH' });
  });

  it('a metric absent from the set behaves like UNAVAILABLE', () => {
    const evaluation = runStrategy(strategy, makeInput(null));
    expect(evaluation.outcome.kind).toBe('INSUFFICIENT_DATA');
  });

  it('explanations come from the same structured reasons the decision used', () => {
    const evaluation = runStrategy(strategy, makeInput(signalTrue()));
    expect(explainReason(evaluation.reasonCodes[0])).toBe('Quality: fixture signal present [supports] (fixture_signal=true)');
  });

  describe('contract violations', () => {
    const wrap = (mutate: (e: StrategyEvaluation) => StrategyEvaluation): DiscoveryStrategy => ({
      identity: FIXTURE_IDENTITY,
      evaluate: (input) => mutate(strategy.evaluate(input)),
    });

    it('rejects an evaluation labelled with another strategy version', () => {
      const bad = wrap((e) => ({ ...e, identity: FIXTURE_IDENTITY_V11 }));
      expect(() => runStrategy(bad, makeInput(signalTrue()))).toThrow(StrategyContractError);
    });

    it('rejects a different symbol, or a timestamp that is not the input asOf', () => {
      expect(() => runStrategy(wrap((e) => ({ ...e, symbol: 'ZZZ' })), makeInput(signalTrue()))).toThrow(/symbol/);
      expect(() => runStrategy(wrap((e) => ({ ...e, evaluatedAt: T1 })), makeInput(signalTrue()))).toThrow(/clock|asOf/);
    });

    it('rejects an evaluation with no reason codes', () => {
      expect(() => runStrategy(wrap((e) => ({ ...e, reasonCodes: [] })), makeInput(signalTrue()))).toThrow(/reason code/);
    });

    it('rejects a risk flag outside the RISK category and an invalid ranking dimension id', () => {
      const notRisk = createReason({ code: 'QUALITY_NOT_A_RISK', polarity: 'CONCERN' });
      expect(() => runStrategy(wrap((e) => ({ ...e, riskFlags: [notRisk] })), makeInput(signalTrue()))).toThrow(/RISK/);
      expect(() =>
        runStrategy(wrap((e) => ({ ...e, rankings: { 'Bad Key': unavailableMetric('score') } })), makeInput(signalTrue())),
      ).toThrow(/Invalid metric id/);
    });

    it('normalizes reason ordering and duplicates before freezing', () => {
      const a = createReason({ code: 'RISK_ZED', polarity: 'CONCERN' });
      const b = createReason({ code: 'QUALITY_ALPHA', polarity: 'SUPPORTS' });
      const evaluation = runStrategy(wrap((e) => ({ ...e, reasonCodes: [a, b, a] })), makeInput(signalTrue()));
      expect(evaluation.reasonCodes.map((r) => r.code)).toEqual(['QUALITY_ALPHA', 'RISK_ZED']);
    });
  });
});

describe('strategy-version reproducibility', () => {
  it('re-running a pinned version over stored input reproduces the stored decision, even after a newer version exists', () => {
    const v10 = createFixtureStrategy(FIXTURE_IDENTITY);
    const stored = runStrategy(v10, makeInput(signalTrue()));

    // A "later" strategy version that decides differently must not alter what v1.0 produces.
    const v11: DiscoveryStrategy = {
      identity: FIXTURE_IDENTITY_V11,
      evaluate: (input) => ({ ...v10.evaluate(input), identity: FIXTURE_IDENTITY_V11, outcome: { kind: 'CLASSIFIED', state: 'ACTIONABLE' } }),
    };
    expect(runStrategy(v11, makeInput(signalTrue())).outcome).toEqual({ kind: 'CLASSIFIED', state: 'ACTIONABLE' });
    expect(runStrategy(v10, makeInput(signalTrue()))).toEqual(stored);
  });
});
