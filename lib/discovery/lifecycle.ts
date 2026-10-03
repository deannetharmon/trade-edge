// lib/discovery/lifecycle.ts

// LEAPS-QV-0001 Gate 1 (items 6-7, Sections 19-20) -- candidate lifecycle and the INSUFFICIENT_DATA outcome.
//
// INSUFFICIENT_DATA is an evaluation OUTCOME, not a lifecycle state and not an investment failure: it means
// "could not evaluate", and it never moves a candidate. Gate 1 supplies the state machine only; which evidence
// maps to which state is strategy logic and arrives with Gate 3.
//
// Episode policy (Quinn Gate 1 ruling): INVALIDATED and EXPIRED are terminal for a candidate EPISODE. An episode
// is never reopened (no INVALIDATED -> DISCOVERED/WATCH/SETUP/ACTIONABLE), because that would rewrite what the
// historical thesis meant. If the same symbol later qualifies again it starts a NEW episode and the terminal one is
// retained. Gate 1 stops at refusing the move and recording it (LifecycleResolution.blockedByTerminalState); the
// episode identity that lets persistence tell the two apart is a later-gate concern (Gate 7).

import { uniqueSorted } from './util';

export const CANDIDATE_STATES = ['DISCOVERED', 'WATCH', 'SETUP', 'ACTIONABLE', 'INVALIDATED', 'EXPIRED'] as const;
export type CandidateState = (typeof CANDIDATE_STATES)[number];

/** Pipeline states. Moves between them are permitted in both directions (Section 19). */
export const ACTIVE_STATES: readonly CandidateState[] = ['DISCOVERED', 'WATCH', 'SETUP', 'ACTIONABLE'];
/** End states. History is preserved; no further transitions are allowed in Gate 1 (see report: open question). */
export const TERMINAL_STATES: readonly CandidateState[] = ['INVALIDATED', 'EXPIRED'];

export function isCandidateState(value: unknown): value is CandidateState {
  return typeof value === 'string' && (CANDIDATE_STATES as readonly string[]).indexOf(value) >= 0;
}

export function isActiveState(state: CandidateState): boolean {
  return ACTIVE_STATES.indexOf(state) >= 0;
}

export function isTerminalState(state: CandidateState): boolean {
  return TERMINAL_STATES.indexOf(state) >= 0;
}

/** States an observer would treat as a live opportunity (used for scan summaries, not for ranking). */
export function isOpportunityState(state: CandidateState): boolean {
  return state === 'WATCH' || state === 'SETUP' || state === 'ACTIONABLE';
}

/**
 * Structural transition rules:
 *  - first observation (from = null): DISCOVERED, WATCH, SETUP or ACTIONABLE (an evaluation may classify a
 *    brand-new candidate immediately; the transition is still recorded with fromState null)
 *  - active -> any other state (forward, reverse, or to a terminal state)
 *  - terminal -> nothing
 *  - self-transitions are not transitions
 */
export function isTransitionAllowed(from: CandidateState | null, to: CandidateState): boolean {
  if (from === null) return isActiveState(to);
  if (from === to) return false;
  return isActiveState(from);
}

export type EvaluationOutcome =
  | { readonly kind: 'CLASSIFIED'; readonly state: CandidateState }
  | { readonly kind: 'INSUFFICIENT_DATA'; readonly missingMetricIds: readonly string[] };

export function classified(state: CandidateState): EvaluationOutcome {
  if (!isCandidateState(state)) throw new Error(`Unknown candidate state "${String(state)}".`);
  return Object.freeze({ kind: 'CLASSIFIED' as const, state });
}

/** The ids that blocked evaluation must be named: "insufficient data" with no cause is not auditable. */
export function insufficientData(missingMetricIds: readonly string[]): EvaluationOutcome {
  if (missingMetricIds.length === 0) {
    throw new Error('INSUFFICIENT_DATA must name at least one metric that blocked evaluation.');
  }
  return Object.freeze({
    kind: 'INSUFFICIENT_DATA' as const,
    missingMetricIds: Object.freeze(uniqueSorted(missingMetricIds)),
  });
}

/**
 * How one evaluation was applied to a candidate's lifecycle. This is persisted with the candidate snapshot
 * (Quinn Gate 1 review, B2) so a stored decision can be reconstructed without anything that existed only
 * transiently while it was being applied -- in particular, why the evaluated state and the persisted state differ.
 */
export interface LifecycleResolution {
  /** The candidate's persisted state before this evaluation; null the first time the symbol is evaluated. */
  readonly previousState: CandidateState | null;
  /** The state the evaluation classified the candidate as; null for an INSUFFICIENT_DATA outcome. */
  readonly requestedState: CandidateState | null;
  /** The persisted state after this evaluation. */
  readonly state: CandidateState;
  /** True when the persisted state changes and a transition must be recorded. */
  readonly changed: boolean;
  /** True when the candidate is already INVALIDATED / EXPIRED and the evaluation asked for a different state. */
  readonly blockedByTerminalState: boolean;
}

/**
 * Decides the candidate's state after an evaluation.
 *  - INSUFFICIENT_DATA: state unchanged (a brand-new candidate is recorded as DISCOVERED).
 *  - CLASSIFIED: the classified state, if the structural rules allow it.
 *  - Terminal candidates never move.
 */
export function resolveNextState(current: CandidateState | null, outcome: EvaluationOutcome): LifecycleResolution {
  const requestedState: CandidateState | null = outcome.kind === 'CLASSIFIED' ? outcome.state : null;
  if (current !== null && isTerminalState(current)) {
    return {
      previousState: current,
      requestedState,
      state: current,
      changed: false,
      blockedByTerminalState: requestedState !== null && requestedState !== current,
    };
  }
  const target: CandidateState = requestedState ?? current ?? 'DISCOVERED';
  if (current === null) {
    if (!isTransitionAllowed(null, target)) {
      throw new Error(`A new candidate cannot first be observed as ${target}.`);
    }
    return { previousState: null, requestedState, state: target, changed: true, blockedByTerminalState: false };
  }
  return {
    previousState: current,
    requestedState,
    state: target,
    changed: target !== current,
    blockedByTerminalState: false,
  };
}

/**
 * Internal-consistency problems of a (possibly stored) resolution; empty means consistent. Lets a snapshot loaded
 * from storage be re-checked, and stops a snapshot being built from a resolution that could not have happened.
 */
export function lifecycleResolutionProblems(resolution: LifecycleResolution): string[] {
  const problems: string[] = [];
  const { previousState, requestedState, state, changed, blockedByTerminalState } = resolution;
  if (!isCandidateState(state)) problems.push(`state "${String(state)}" is not a candidate state.`);
  if (previousState !== null && !isCandidateState(previousState)) problems.push('previousState is not a candidate state.');
  if (requestedState !== null && !isCandidateState(requestedState)) problems.push('requestedState is not a candidate state.');
  if (changed !== (previousState !== state)) problems.push('changed does not match previousState -> state.');

  if (blockedByTerminalState) {
    if (previousState === null || !isTerminalState(previousState)) problems.push('blocked, but previousState is not terminal.');
    if (requestedState === null || requestedState === previousState) problems.push('blocked, but no different state was requested.');
    if (state !== previousState) problems.push('blocked, but the persisted state moved.');
  } else if (previousState !== null && isTerminalState(previousState)) {
    if (state !== previousState) problems.push('a terminal state cannot change.');
    if (requestedState !== null && requestedState !== previousState) problems.push('a different requested state from a terminal state must be marked blocked.');
  } else if (requestedState !== null) {
    if (state !== requestedState) problems.push('state differs from the requested state without being blocked.');
  } else if (state !== (previousState ?? 'DISCOVERED')) {
    problems.push('an INSUFFICIENT_DATA evaluation must not change the state.');
  }
  return problems;
}
