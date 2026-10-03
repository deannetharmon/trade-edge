// lib/discovery/snapshot.ts

// LEAPS-QV-0001 Gate 1 (item 8, Sections 28-29) -- the persistent candidate snapshot model.
//
// A snapshot freezes everything a decision rested on: strategy id/version, timestamp, underlying and price,
// every metric with its validity, gate outcomes, reason codes, candidate state, rankings, risk flags, data
// completeness, and (where applicable) the selected contract, its market data and scenario results.
// Its id is a fingerprint of its content, so the same evidence always yields the same id and a transition's
// metricSnapshotId can be re-verified against stored data. Gate 1 defines the shape only; nothing is persisted.
//
// Survivorship (Section 29): the model has no notion of "keeping only winners" -- INSUFFICIENT_DATA outcomes,
// INVALIDATED / EXPIRED states and no-contract setups are all representable and snapshotted like any other.

import type { StrategyEvaluation, StrategyInput, GateOutcome } from './evaluation';
import type { CandidateState, EvaluationOutcome } from './lifecycle';
import { isCandidateState } from './lifecycle';
import type { DataCompleteness, MetricSet, NormalizedMetric } from './metrics';
import type { ReasonCode } from './reasonCodes';
import type { StrategyIdentity } from './strategy';
import { deepFreeze, hashString, stableStringify } from './util';
import type { JsonObject } from './util';

export interface CandidateSnapshot {
  readonly snapshotId: string;
  readonly strategyId: string;
  readonly strategyVersion: string;
  readonly capturedAt: string;
  readonly symbol: string;
  readonly underlyingPrice: NormalizedMetric<number>;
  readonly metrics: MetricSet;
  readonly gateOutcomes: readonly GateOutcome[];
  readonly reasonCodes: readonly ReasonCode[];
  readonly riskFlags: readonly ReasonCode[];
  readonly candidateState: CandidateState;
  readonly evaluationOutcome: EvaluationOutcome;
  readonly rankings: Readonly<Record<string, NormalizedMetric<number>>>;
  readonly dataCompleteness: DataCompleteness;
  /** Opaque, JSON-safe payloads owned by later gates (contract engine, scenario engine). null when not applicable. */
  readonly selectedContract: JsonObject | null;
  readonly contractMarketData: JsonObject | null;
  readonly scenarios: readonly JsonObject[];
}

export interface SnapshotExtras {
  readonly selectedContract?: JsonObject | null;
  readonly contractMarketData?: JsonObject | null;
  readonly scenarios?: readonly JsonObject[];
}

export type SnapshotContent = Omit<CandidateSnapshot, 'snapshotId'>;

export function computeSnapshotId(content: SnapshotContent): string {
  return `snap_${hashString(stableStringify(content))}`;
}

/**
 * Builds the immutable snapshot for one evaluation. `state` is the lifecycle state AFTER the evaluation was
 * applied (see advanceCandidate); it must agree with the evaluation outcome.
 */
export function createCandidateSnapshot(
  input: StrategyInput,
  evaluation: StrategyEvaluation,
  state: CandidateState,
  extras: SnapshotExtras = {},
): CandidateSnapshot {
  if (evaluation.symbol !== input.symbol) {
    throw new Error('Snapshot evaluation does not belong to the supplied input.');
  }
  if (evaluation.evaluatedAt !== input.asOf) throw new Error('Snapshot evaluation timestamp differs from the input asOf.');
  if (!isCandidateState(state)) throw new Error(`Unknown candidate state "${String(state)}".`);

  const content: SnapshotContent = {
    strategyId: evaluation.identity.strategyId,
    strategyVersion: evaluation.identity.strategyVersion,
    capturedAt: evaluation.evaluatedAt,
    symbol: evaluation.symbol,
    underlyingPrice: input.underlyingPrice,
    metrics: input.metrics,
    gateOutcomes: evaluation.gateOutcomes,
    reasonCodes: evaluation.reasonCodes,
    riskFlags: evaluation.riskFlags,
    candidateState: state,
    evaluationOutcome: evaluation.outcome,
    rankings: evaluation.rankings,
    dataCompleteness: evaluation.dataCompleteness,
    selectedContract: extras.selectedContract ?? null,
    contractMarketData: extras.contractMarketData ?? null,
    scenarios: extras.scenarios ?? [],
  };
  return deepFreeze({ snapshotId: computeSnapshotId(content), ...content });
}

/** True when the stored id still matches the stored content (detects tampering / partial writes). */
export function verifySnapshot(snapshot: CandidateSnapshot): boolean {
  const { snapshotId, ...content } = snapshot;
  return computeSnapshotId(content) === snapshotId;
}

export function snapshotIdentity(snapshot: CandidateSnapshot): StrategyIdentity {
  return { strategyId: snapshot.strategyId, strategyVersion: snapshot.strategyVersion };
}
