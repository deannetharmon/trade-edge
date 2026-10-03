// lib/discovery/lifecycle.ts

// LEAPS-QV-0001 Gate 1 (items 6-7, Sections 19-20) -- candidate lifecycle and the INSUFFICIENT_DATA outcome.
//
// INSUFFICIENT_DATA is an evaluation OUTCOME, not a lifecycle state and not an investment failure: it means
// "could not evaluate", and it never moves a candidate. Gate 1 supplies the state machine only; which evidence
// maps to which state is strategy logic and arrives with Gate 3.

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

export interface ResolvedState {
  readonly state: CandidateState;
  /** True when the persisted state changes and a transition must be recorded. */
  readonly changed: boolean;
  /** Set when the candidate is already terminal and the outcome asked for a different state. */
  readonly blockedByTerminalState: boolean;
}

/**
 * Decides the candidate's state after an evaluation.
 *  - INSUFFICIENT_DATA: state unchanged (a brand-new candidate is recorded as DISCOVERED).
 *  - CLASSIFIED: the classified state, if the structural rules allow it.
 *  - Terminal candidates never move.
 */
export function resolveNextState(current: CandidateState | null, outcome: EvaluationOutcome): ResolvedState {
  if (current !== null && isTerminalState(current)) {
    const wanted = outcome.kind === 'CLASSIFIED' ? outcome.state : current;
    return { state: current, changed: false, blockedByTerminalState: wanted !== current };
  }
  const target: CandidateState = outcome.kind === 'CLASSIFIED' ? outcome.state : current ?? 'DISCOVERED';
  if (current === null) {
    if (!isTransitionAllowed(null, target)) {
      throw new Error(`A new candidate cannot first be observed as ${target}.`);
    }
    return { state: target, changed: true, blockedByTerminalState: false };
  }
  return { state: target, changed: target !== current, blockedByTerminalState: false };
}
