// lib/discovery/transitions.ts

// LEAPS-QV-0001 Gate 1 (item 9, Section 21) -- append-only state-transition history.
//
// A transition records fromState, toState, timestamp, strategy, strategyVersion, metricSnapshotId and
// reasonCodes. The history is an immutable value: appendTransition returns a NEW history and validates the
// chain, so persisted data loaded later (Gate 7) can be re-checked with validateTransitionHistory.

import { isTransitionAllowed } from './lifecycle';
import type { CandidateState } from './lifecycle';
import { isCandidateState } from './lifecycle';
import type { ReasonCode } from './reasonCodes';
import { sameStrategyIdentity } from './strategy';
import type { StrategyIdentity } from './strategy';
import { deepFreeze, isIsoTimestamp } from './util';

export interface StateTransition {
  /** null for the first observation of a candidate. */
  readonly fromState: CandidateState | null;
  readonly toState: CandidateState;
  readonly timestamp: string;
  readonly strategyId: string;
  readonly strategyVersion: string;
  readonly metricSnapshotId: string;
  readonly reasonCodes: readonly ReasonCode[];
}

export interface TransitionHistory {
  readonly symbol: string;
  readonly strategy: StrategyIdentity;
  readonly transitions: readonly StateTransition[];
}

export function createTransitionHistory(symbol: string, strategy: StrategyIdentity): TransitionHistory {
  const normalized = symbol.trim().toUpperCase();
  if (!normalized) throw new Error('A transition history needs a symbol.');
  return deepFreeze({ symbol: normalized, strategy: { ...strategy }, transitions: [] });
}

export function currentStateOf(history: TransitionHistory): CandidateState | null {
  const last = history.transitions[history.transitions.length - 1];
  return last ? last.toState : null;
}

export interface TransitionRequest {
  readonly toState: CandidateState;
  readonly timestamp: string;
  readonly strategy: StrategyIdentity;
  readonly metricSnapshotId: string;
  readonly reasonCodes: readonly ReasonCode[];
}

/** Returns a new history with the transition appended, or throws when the transition is not valid. */
export function appendTransition(history: TransitionHistory, request: TransitionRequest): TransitionHistory {
  if (!sameStrategyIdentity(history.strategy, request.strategy)) {
    throw new Error(
      `Transition strategy ${request.strategy.strategyVersion} does not match history strategy ${history.strategy.strategyVersion}.`,
    );
  }
  if (!isCandidateState(request.toState)) throw new Error(`Unknown candidate state "${String(request.toState)}".`);
  if (!isIsoTimestamp(request.timestamp)) throw new Error('Transition timestamp must be an ISO-8601 timestamp.');
  if (!request.metricSnapshotId) throw new Error('A transition must reference the metric snapshot that justified it.');
  if (request.reasonCodes.length === 0) {
    throw new Error('A transition must carry at least one reason code (explainability is mandatory).');
  }

  const last = history.transitions[history.transitions.length - 1];
  if (last && Date.parse(request.timestamp) < Date.parse(last.timestamp)) {
    throw new Error('Transition timestamp precedes the previous transition.');
  }
  const fromState = last ? last.toState : null;
  if (!isTransitionAllowed(fromState, request.toState)) {
    throw new Error(`Transition ${fromState ?? 'null'} -> ${request.toState} is not allowed.`);
  }

  const transition: StateTransition = {
    fromState,
    toState: request.toState,
    timestamp: request.timestamp,
    strategyId: request.strategy.strategyId,
    strategyVersion: request.strategy.strategyVersion,
    metricSnapshotId: request.metricSnapshotId,
    reasonCodes: request.reasonCodes,
  };
  return deepFreeze({
    symbol: history.symbol,
    strategy: history.strategy,
    transitions: [...history.transitions, transition],
  });
}

/**
 * Re-checks a history that was loaded from storage. Returns human-readable problems; empty means consistent.
 */
export function validateTransitionHistory(history: TransitionHistory): string[] {
  const problems: string[] = [];
  let previous: StateTransition | null = null;
  history.transitions.forEach((transition, index) => {
    const label = `transition #${index}`;
    const expectedFrom: CandidateState | null = previous ? previous.toState : null;
    if (transition.fromState !== expectedFrom) {
      problems.push(`${label}: fromState ${transition.fromState ?? 'null'} does not continue from ${expectedFrom ?? 'null'}.`);
    }
    if (!isTransitionAllowed(transition.fromState, transition.toState)) {
      problems.push(`${label}: ${transition.fromState ?? 'null'} -> ${transition.toState} is not allowed.`);
    }
    if (!isIsoTimestamp(transition.timestamp)) {
      problems.push(`${label}: timestamp is not ISO-8601.`);
    } else if (previous && Date.parse(transition.timestamp) < Date.parse(previous.timestamp)) {
      problems.push(`${label}: timestamp precedes the previous transition.`);
    }
    if (transition.strategyId !== history.strategy.strategyId || transition.strategyVersion !== history.strategy.strategyVersion) {
      problems.push(`${label}: strategy identity differs from the history's strategy.`);
    }
    if (!transition.metricSnapshotId) problems.push(`${label}: missing metricSnapshotId.`);
    if (transition.reasonCodes.length === 0) problems.push(`${label}: no reason codes.`);
    previous = transition;
  });
  return problems;
}

export function countTransitionsTo(history: TransitionHistory, state: CandidateState): number {
  return history.transitions.filter((transition) => transition.toState === state).length;
}
