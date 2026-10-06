// lib/discovery/leaps/orchestrate.ts

// LEAPS-QV-0001 Gate 4c -- Gate 3 -> Gate 4 handoff (spec Section 10). Takes {symbol, StrategyEvaluation} pairs,
// acquires chains only for SETUP / ACTIONABLE underlyings (4a), evaluates every pair (4b) and returns QvLeapsResult.
// The Gate 3 evaluation is passed through by reference and never changed. All I/O and time are injected: `now()` is
// read once before acquisition (selection: DTE window, session state, spot basis) and once after all provider I/O
// (evaluation, 4.1). No production caller exists yet (P2); the browser binding is lib/scans/leapsQvTransport.ts.

import type { StrategyEvaluation } from '../evaluation';
import { acquireLeapsRun, type LeapsChainAcquisition, type ProviderGet, type RunStopCode, type Sleep } from './acquisition';
import { QV_LEAPS_ACQUISITION_V1, type QvLeapsAcquisitionPolicy } from './acquisitionPolicy';
import { evaluateLeaps, type LeapsEvaluation } from './evaluate';
import { QV_LEAPS_POLICY_V1, type QvLeapsPolicy } from './policy';

export interface QvLeapsResult {
  underlying: StrategyEvaluation;
  leaps: LeapsEvaluation;
}

export interface QvLeapsRun {
  results: QvLeapsResult[];
  requestsUsed: number;
  stopped: RunStopCode | null;
  /** The evaluation instant (read after all provider I/O). */
  evaluatedAt: string;
}

export interface QvLeapsDeps {
  get: ProviderGet;
  sleep: Sleep;
  /** Current time as ISO-8601; injected so the module never reads the clock. */
  now: () => string;
}

const QUALIFYING = ['SETUP', 'ACTIONABLE'];

export function underlyingStateOf(evaluation: StrategyEvaluation): string {
  return evaluation.outcome.kind === 'CLASSIFIED' ? evaluation.outcome.state : evaluation.outcome.kind;
}

/** Placeholder acquisition for underlyings that are never acquired; the evaluator's rule 1 decides them first. */
function notAcquired(symbol: string): LeapsChainAcquisition {
  return { symbol, status: 'NOT_EVALUATED_RUN_CAP', reason: null, sessionState: null, underlying: null, spot: null, chain: null };
}

export async function runQvLeaps(
  pairs: readonly { symbol: string; evaluation: StrategyEvaluation }[],
  deps: QvLeapsDeps,
  policies: { acquisition: QvLeapsAcquisitionPolicy; evaluation: QvLeapsPolicy } = { acquisition: QV_LEAPS_ACQUISITION_V1, evaluation: QV_LEAPS_POLICY_V1 },
): Promise<QvLeapsRun> {
  const qualifyingSymbols = pairs.filter((p) => QUALIFYING.indexOf(underlyingStateOf(p.evaluation)) >= 0).map((p) => p.symbol);
  const selectionNow = Date.parse(deps.now()) / 1000;
  const run = await acquireLeapsRun(qualifyingSymbols, { get: deps.get, nowEpochSeconds: selectionNow, sleep: deps.sleep }, policies.acquisition);
  const evaluatedAt = deps.now();

  let next = 0;
  const results = pairs.map((pair) => {
    const state = underlyingStateOf(pair.evaluation);
    const acquisition = QUALIFYING.indexOf(state) >= 0 ? run.results[next++] : notAcquired(pair.symbol);
    const leaps = evaluateLeaps({ symbol: pair.symbol, underlyingState: state, now: evaluatedAt, acquisition, policy: policies.evaluation });
    return { underlying: pair.evaluation, leaps };
  });
  return { results, requestsUsed: run.requestsUsed, stopped: run.stopped, evaluatedAt };
}
