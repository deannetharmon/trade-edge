// lib/discovery/candidate.ts

// LEAPS-QV-0001 Gate 1 -- ties evaluation, lifecycle, snapshot and transition history together.
//
// advanceCandidate is the one place that applies an evaluation to a candidate: it resolves the next state,
// builds the snapshot that justifies it, and (only when the state really changes) appends the transition that
// points at that snapshot. Every evaluation yields a snapshot -- including INSUFFICIENT_DATA ones and ones that
// change nothing -- so the learning dataset never silently drops the unflattering cases.

import type { StrategyEvaluation, StrategyInput } from './evaluation';
import { resolveNextState } from './lifecycle';
import type { CandidateState } from './lifecycle';
import { createCandidateSnapshot } from './snapshot';
import type { CandidateSnapshot, SnapshotExtras } from './snapshot';
import { sameStrategyIdentity } from './strategy';
import type { StrategyIdentity } from './strategy';
import { appendTransition, createTransitionHistory, currentStateOf } from './transitions';
import type { StateTransition, TransitionHistory } from './transitions';
import { deepFreeze } from './util';

export interface CandidateRecord {
  readonly symbol: string;
  readonly strategy: StrategyIdentity;
  readonly state: CandidateState;
  readonly lastSnapshotId: string;
  readonly history: TransitionHistory;
}

export interface AdvanceResult {
  readonly record: CandidateRecord;
  readonly snapshot: CandidateSnapshot;
  /** null when the state did not change (including every INSUFFICIENT_DATA outcome on an existing candidate). */
  readonly transition: StateTransition | null;
  /** The evaluation asked for a state change but the candidate is already INVALIDATED / EXPIRED. */
  readonly blockedByTerminalState: boolean;
}

/**
 * Applies one evaluation to a candidate (`previous` is null the first time a symbol is evaluated).
 * Throws if the evaluation belongs to a different strategy version than the record: a version bump starts a
 * separate record so historical QV-v1.0 decisions stay reproducible.
 */
export function advanceCandidate(
  previous: CandidateRecord | null,
  input: StrategyInput,
  evaluation: StrategyEvaluation,
  extras: SnapshotExtras = {},
): AdvanceResult {
  if (previous) {
    if (!sameStrategyIdentity(previous.strategy, evaluation.identity)) {
      throw new Error(
        `Candidate ${previous.symbol} is tracked under ${previous.strategy.strategyVersion}, not ${evaluation.identity.strategyVersion}.`,
      );
    }
    if (previous.symbol !== evaluation.symbol) {
      throw new Error(`Candidate record ${previous.symbol} cannot absorb an evaluation of ${evaluation.symbol}.`);
    }
  }

  const history = previous ? previous.history : createTransitionHistory(evaluation.symbol, evaluation.identity);
  const resolved = resolveNextState(currentStateOf(history), evaluation.outcome);
  const snapshot = createCandidateSnapshot(input, evaluation, resolved.state, extras);

  const nextHistory = resolved.changed
    ? appendTransition(history, {
        toState: resolved.state,
        timestamp: evaluation.evaluatedAt,
        strategy: evaluation.identity,
        metricSnapshotId: snapshot.snapshotId,
        reasonCodes: evaluation.reasonCodes,
      })
    : history;

  const transition = resolved.changed ? nextHistory.transitions[nextHistory.transitions.length - 1] : null;
  const record: CandidateRecord = deepFreeze({
    symbol: evaluation.symbol,
    strategy: evaluation.identity,
    state: resolved.state,
    lastSnapshotId: snapshot.snapshotId,
    history: nextHistory,
  });
  return { record, snapshot, transition, blockedByTerminalState: resolved.blockedByTerminalState };
}
