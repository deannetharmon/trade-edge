// lib/discovery/__tests__/fixtures.ts

// LEAPS-QV-0001 Gate 1 -- test scaffolding for the Discovery Strategy Engine.
// The fixture strategy below exercises the FRAMEWORK plumbing only (one boolean signal -> a lifecycle state).
// It contains no Quality Value thresholds, scoring or investment rules.

import {
  classified,
  createReason,
  createStrategyIdentity,
  createStrategyInput,
  dataLimitationReason,
  evaluateCriterion,
  getMetric,
  insufficientData,
  summarizeDataCompleteness,
  unavailableMetric,
  validMetric,
} from '..';
import type { DiscoveryStrategy, MetricSet, NormalizedMetric, StrategyEvaluation, StrategyInput } from '..';

export const T0 = '2026-10-03T14:00:00.000Z';
export const T1 = '2026-10-04T14:00:00.000Z';
export const T2 = '2026-10-05T14:00:00.000Z';

export const FIXTURE_IDENTITY = createStrategyIdentity('FIX', 'FIX-v1.0');
export const FIXTURE_IDENTITY_V11 = createStrategyIdentity('FIX', 'FIX-v1.1');

export function priceMetric(asOf: string = T0, price = 100): NormalizedMetric<number> {
  return validMetric('underlying_price', price, asOf);
}

export function makeInput(
  signal: NormalizedMetric | null,
  options: { symbol?: string; asOf?: string; extra?: NormalizedMetric[] } = {},
): StrategyInput {
  const asOf = options.asOf ?? T0;
  const metrics: Record<string, NormalizedMetric> = {};
  if (signal) metrics[signal.id] = signal;
  (options.extra || []).forEach((metric) => {
    metrics[metric.id] = metric;
  });
  return createStrategyInput({
    symbol: options.symbol ?? 'ABC',
    asOf,
    underlyingPrice: priceMetric(asOf),
    metrics: metrics as MetricSet,
  });
}

export const signalTrue = (asOf: string = T0): NormalizedMetric => validMetric('fixture_signal', true, asOf);
export const signalFalse = (asOf: string = T0): NormalizedMetric => validMetric('fixture_signal', false, asOf);
export const signalMissing = (): NormalizedMetric => unavailableMetric('fixture_signal', 'NOT_PROVIDED');

/**
 * true  -> SETUP,  false -> WATCH,  anything not VALID -> INSUFFICIENT_DATA (never a pass or a fail).
 */
export function createFixtureStrategy(identity = FIXTURE_IDENTITY): DiscoveryStrategy {
  return {
    identity,
    evaluate(input: StrategyInput): StrategyEvaluation {
      const signal = getMetric(input.metrics, 'fixture_signal');
      const criterion = evaluateCriterion('fixture_gate', [signal], (valid) => valid[0].value === true);

      const reason =
        criterion.result === 'NOT_EVALUABLE'
          ? dataLimitationReason(signal)
          : createReason({
              code: criterion.result === 'PASS' ? 'QUALITY_FIXTURE_SIGNAL_PRESENT' : 'QUALITY_FIXTURE_SIGNAL_ABSENT',
              polarity: criterion.result === 'PASS' ? 'SUPPORTS' : 'CONCERN',
              evidence: [signal],
            });

      return {
        identity,
        symbol: input.symbol,
        evaluatedAt: input.asOf,
        outcome:
          criterion.result === 'NOT_EVALUABLE'
            ? insufficientData(criterion.blockingMetrics.map((metric) => metric.id))
            : classified(criterion.result === 'PASS' ? 'SETUP' : 'WATCH'),
        gateOutcomes: [{ gateId: 'fixture_gate', result: criterion.result, reasonCodes: [reason] }],
        reasonCodes: [reason],
        riskFlags: [],
        rankings: {},
        dataCompleteness: summarizeDataCompleteness(input.metrics, ['fixture_signal'], ['fixture_signal']),
      };
    },
  };
}
