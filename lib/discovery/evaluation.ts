// lib/discovery/evaluation.ts

// LEAPS-QV-0001 Gate 1 (item 2, Sections 6 and 22) -- the strategy execution contract.
//
// A DiscoveryStrategy is a PURE function of normalized TradeEdge data: no provider response shapes, no
// clock, no randomness, no network. That is what makes a historical evaluation reproducible under its
// strategy version. runStrategy is the single guarded entry point: it checks that what a strategy returns
// is consistent with what it was given and with the framework's invariants.

import type { EvaluationOutcome } from './lifecycle';
import type { CriterionResult, DataCompleteness, MetricSet, NormalizedMetric } from './metrics';
import { assertMetricId } from './metrics';
import type { ReasonCode } from './reasonCodes';
import { normalizeReasons } from './reasonCodes';
import { sameStrategyIdentity } from './strategy';
import type { StrategyIdentity } from './strategy';
import { deepFreeze, isIsoTimestamp } from './util';

/** Normalized input. Strategies never see provider-specific structures (Section 6 rule). */
export interface StrategyInput {
  readonly symbol: string;
  /** The evaluation instant, supplied by the caller. Strategies must not read the clock. */
  readonly asOf: string;
  readonly underlyingPrice: NormalizedMetric<number>;
  readonly metrics: MetricSet;
}

export function createStrategyInput(input: {
  symbol: string;
  asOf: string;
  underlyingPrice: NormalizedMetric<number>;
  metrics: MetricSet;
}): StrategyInput {
  const symbol = input.symbol.trim().toUpperCase();
  if (!symbol) throw new Error('A strategy input needs a symbol.');
  if (!isIsoTimestamp(input.asOf)) throw new Error('Strategy input asOf must be an ISO-8601 timestamp.');
  Object.keys(input.metrics).forEach((id) => {
    assertMetricId(id);
    if (input.metrics[id].id !== id) {
      throw new Error(`Metric set key "${id}" does not match metric id "${input.metrics[id].id}".`);
    }
  });
  return deepFreeze({ symbol, asOf: input.asOf, underlyingPrice: input.underlyingPrice, metrics: input.metrics });
}

/** Outcome of one named gate (e.g. a quality gate). NOT_EVALUABLE is distinct from FAIL. */
export interface GateOutcome {
  readonly gateId: string;
  readonly result: CriterionResult;
  readonly reasonCodes: readonly ReasonCode[];
}

export interface StrategyEvaluation {
  readonly identity: StrategyIdentity;
  readonly symbol: string;
  readonly evaluatedAt: string;
  readonly outcome: EvaluationOutcome;
  readonly gateOutcomes: readonly GateOutcome[];
  readonly reasonCodes: readonly ReasonCode[];
  /** Risk flags are reasons in the RISK category. */
  readonly riskFlags: readonly ReasonCode[];
  /**
   * Independent ranking dimensions (Section 23), keyed by dimension id. Each is a normalized metric so an
   * unscored dimension is UNAVAILABLE rather than 0. Gate 1 defines no dimensions; strategies declare theirs.
   */
  readonly rankings: Readonly<Record<string, NormalizedMetric<number>>>;
  readonly dataCompleteness: DataCompleteness;
}

export interface DiscoveryStrategy {
  readonly identity: StrategyIdentity;
  /** Must be deterministic: equal input -> equal evaluation. */
  evaluate(input: StrategyInput): StrategyEvaluation;
}

export class StrategyContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StrategyContractError';
  }
}

/**
 * Runs a strategy and enforces the contract on its result:
 *  - evaluation identity equals the strategy's identity (no mislabelled decisions)
 *  - symbol and timestamp echo the input
 *  - at least one reason code (explainability is mandatory)
 *  - every riskFlag is a RISK-category reason
 *  - every ranking key is a valid dimension id
 * Reasons are normalized (deduplicated, deterministically ordered) and the result is frozen.
 */
export function runStrategy(strategy: DiscoveryStrategy, input: StrategyInput): StrategyEvaluation {
  const evaluation = strategy.evaluate(input);

  if (!sameStrategyIdentity(evaluation.identity, strategy.identity)) {
    throw new StrategyContractError(
      `Evaluation identity ${evaluation.identity.strategyVersion} differs from strategy ${strategy.identity.strategyVersion}.`,
    );
  }
  if (evaluation.symbol !== input.symbol) {
    throw new StrategyContractError(`Evaluation symbol ${evaluation.symbol} differs from input symbol ${input.symbol}.`);
  }
  if (evaluation.evaluatedAt !== input.asOf) {
    throw new StrategyContractError('Evaluation timestamp must equal the input asOf (strategies do not read the clock).');
  }
  if (evaluation.reasonCodes.length === 0) {
    throw new StrategyContractError('An evaluation must carry at least one reason code.');
  }
  evaluation.riskFlags.forEach((flag) => {
    if (flag.category !== 'RISK') {
      throw new StrategyContractError(`Risk flag ${flag.code} is not in the RISK category.`);
    }
  });
  Object.keys(evaluation.rankings).forEach((dimension) => assertMetricId(dimension));

  return deepFreeze({
    ...evaluation,
    reasonCodes: normalizeReasons(evaluation.reasonCodes),
    riskFlags: normalizeReasons(evaluation.riskFlags),
    gateOutcomes: evaluation.gateOutcomes.map((gate) => ({ ...gate, reasonCodes: normalizeReasons(gate.reasonCodes) })),
  });
}
