// lib/discovery/observability.ts

// LEAPS-QV-0001 Gate 1 (item 10, Section 31) -- scan observability model.
//
// The central requirement: "no opportunities found" and "the scan failed to evaluate correctly" must be
// distinguishable. A ScanRecorder accumulates counts while a scan runs; finalize() produces an immutable
// ScanSummary whose `health` and `opportunityOutcome` make that distinction explicit. The recorder never
// reads the clock -- start/end instants are passed in -- so summaries are reproducible in tests.

import type { StrategyEvaluation } from './evaluation';
import { isOpportunityState, CANDIDATE_STATES } from './lifecycle';
import type { CandidateState } from './lifecycle';
import { countMetricValidity } from './metrics';
import type { MetricSet } from './metrics';
import type { StrategyIdentity } from './strategy';
import type { StateTransition } from './transitions';
import { deepFreeze, isIsoTimestamp } from './util';

export type ScanHealth = 'HEALTHY' | 'DEGRADED' | 'FAILED';

/**
 * CANDIDATES_FOUND                  -- at least one WATCH / SETUP / ACTIONABLE candidate.
 * NO_CANDIDATES                     -- scan HEALTHY, every symbol evaluated, none qualified. A genuine "nothing found".
 * NO_CANDIDATES_AMONG_EVALUATED     -- none qualified, but coverage was incomplete (errors, provider failures or
 *                                      INSUFFICIENT_DATA), so "nothing exists" cannot be claimed.
 * NOT_DETERMINED                    -- scan FAILED; no conclusion about opportunities is valid.
 */
export type OpportunityOutcome =
  | 'CANDIDATES_FOUND'
  | 'NO_CANDIDATES'
  | 'NO_CANDIDATES_AMONG_EVALUATED'
  | 'NOT_DETERMINED';

export interface GateCounts {
  readonly PASS: number;
  readonly FAIL: number;
  readonly NOT_EVALUABLE: number;
}

export interface ScanFailureRecord {
  readonly scope: string;
  readonly detail: string;
}

export interface ScanSummary {
  readonly strategy: StrategyIdentity;
  readonly startedAt: string;
  readonly endedAt: string;
  readonly durationMs: number;
  readonly universeSize: number;
  readonly evaluatedCount: number;
  readonly insufficientDataCount: number;
  readonly evaluationErrorCount: number;
  readonly gateCounts: Readonly<Record<string, GateCounts>>;
  readonly metricValidityCounts: { readonly VALID: number; readonly UNAVAILABLE: number; readonly STALE: number; readonly INVALID: number };
  readonly providerFailures: readonly ScanFailureRecord[];
  readonly optionChainFailures: readonly ScanFailureRecord[];
  readonly evaluationErrors: readonly ScanFailureRecord[];
  readonly apiCalls: Readonly<Record<string, number>>;
  readonly candidateStateCounts: Readonly<Record<CandidateState, number>>;
  readonly invalidationTransitionCount: number;
  readonly fatalReason: string | null;
  readonly health: ScanHealth;
  readonly healthReasons: readonly string[];
  readonly opportunityOutcome: OpportunityOutcome;
}

export interface ScanRecorder {
  recordEvaluation(evaluation: StrategyEvaluation, metrics?: MetricSet): void;
  recordTransition(transition: StateTransition): void;
  recordProviderFailure(provider: string, detail: string): void;
  recordOptionChainFailure(symbol: string, detail: string): void;
  recordEvaluationError(symbol: string, detail: string): void;
  recordApiCalls(provider: string, calls: number): void;
  /** Marks the whole scan as unable to produce a trustworthy result (e.g. universe could not be loaded). */
  recordFatal(reason: string): void;
  finalize(endedAt: string): ScanSummary;
}

export function createScanRecorder(options: {
  strategy: StrategyIdentity;
  startedAt: string;
  universeSize: number;
}): ScanRecorder {
  if (!isIsoTimestamp(options.startedAt)) throw new Error('Scan startedAt must be an ISO-8601 timestamp.');
  if (!Number.isInteger(options.universeSize) || options.universeSize < 0) {
    throw new Error('Scan universeSize must be a non-negative integer.');
  }

  let evaluated = 0;
  let insufficient = 0;
  let invalidations = 0;
  let fatalReason: string | null = null;
  const gateCounts: Record<string, { PASS: number; FAIL: number; NOT_EVALUABLE: number }> = {};
  const validity = { VALID: 0, UNAVAILABLE: 0, STALE: 0, INVALID: 0 };
  const providerFailures: ScanFailureRecord[] = [];
  const optionChainFailures: ScanFailureRecord[] = [];
  const evaluationErrors: ScanFailureRecord[] = [];
  const apiCalls: Record<string, number> = {};
  const stateCounts = {} as Record<CandidateState, number>;
  CANDIDATE_STATES.forEach((state) => {
    stateCounts[state] = 0;
  });

  return {
    recordEvaluation(evaluation, metrics) {
      evaluated += 1;
      if (evaluation.outcome.kind === 'INSUFFICIENT_DATA') {
        insufficient += 1;
      } else {
        stateCounts[evaluation.outcome.state] += 1;
      }
      evaluation.gateOutcomes.forEach((gate) => {
        const bucket = gateCounts[gate.gateId] || (gateCounts[gate.gateId] = { PASS: 0, FAIL: 0, NOT_EVALUABLE: 0 });
        bucket[gate.result] += 1;
      });
      if (metrics) {
        const counts = countMetricValidity(metrics);
        validity.VALID += counts.VALID;
        validity.UNAVAILABLE += counts.UNAVAILABLE;
        validity.STALE += counts.STALE;
        validity.INVALID += counts.INVALID;
      }
    },
    recordTransition(transition) {
      if (transition.toState === 'INVALIDATED') invalidations += 1;
    },
    recordProviderFailure(provider, detail) {
      providerFailures.push({ scope: provider, detail });
    },
    recordOptionChainFailure(symbol, detail) {
      optionChainFailures.push({ scope: symbol, detail });
    },
    recordEvaluationError(symbol, detail) {
      evaluationErrors.push({ scope: symbol, detail });
    },
    recordApiCalls(provider, calls) {
      if (!Number.isFinite(calls) || calls < 0) throw new Error('API call count must be a non-negative number.');
      apiCalls[provider] = (apiCalls[provider] || 0) + calls;
    },
    recordFatal(reason) {
      fatalReason = reason;
    },
    finalize(endedAt) {
      if (!isIsoTimestamp(endedAt)) throw new Error('Scan endedAt must be an ISO-8601 timestamp.');
      const durationMs = Date.parse(endedAt) - Date.parse(options.startedAt);
      if (durationMs < 0) throw new Error('Scan endedAt precedes startedAt.');

      const reasons: string[] = [];
      if (fatalReason) reasons.push(`FATAL: ${fatalReason}`);
      if (options.universeSize === 0) reasons.push('EMPTY_UNIVERSE');
      if (options.universeSize > 0 && evaluated === 0) reasons.push('NO_SYMBOL_EVALUATED');
      if (evaluationErrors.length > 0) reasons.push(`EVALUATION_ERRORS:${evaluationErrors.length}`);
      if (providerFailures.length > 0) reasons.push(`PROVIDER_FAILURES:${providerFailures.length}`);
      if (optionChainFailures.length > 0) reasons.push(`OPTION_CHAIN_FAILURES:${optionChainFailures.length}`);
      if (evaluated < options.universeSize) reasons.push(`UNEVALUATED_SYMBOLS:${options.universeSize - evaluated}`);

      const failed = fatalReason !== null || options.universeSize === 0 || (options.universeSize > 0 && evaluated === 0);
      const health: ScanHealth = failed ? 'FAILED' : reasons.length > 0 ? 'DEGRADED' : 'HEALTHY';

      const opportunityCount = CANDIDATE_STATES.filter(isOpportunityState).reduce((sum, state) => sum + stateCounts[state], 0);
      let opportunityOutcome: OpportunityOutcome;
      if (health === 'FAILED') opportunityOutcome = 'NOT_DETERMINED';
      else if (opportunityCount > 0) opportunityOutcome = 'CANDIDATES_FOUND';
      else if (health === 'HEALTHY' && insufficient === 0) opportunityOutcome = 'NO_CANDIDATES';
      else opportunityOutcome = 'NO_CANDIDATES_AMONG_EVALUATED';

      return deepFreeze({
        strategy: options.strategy,
        startedAt: options.startedAt,
        endedAt,
        durationMs,
        universeSize: options.universeSize,
        evaluatedCount: evaluated,
        insufficientDataCount: insufficient,
        evaluationErrorCount: evaluationErrors.length,
        gateCounts: JSON.parse(JSON.stringify(gateCounts)) as Record<string, GateCounts>,
        metricValidityCounts: { ...validity },
        providerFailures: providerFailures.slice(),
        optionChainFailures: optionChainFailures.slice(),
        evaluationErrors: evaluationErrors.slice(),
        apiCalls: { ...apiCalls },
        candidateStateCounts: { ...stateCounts },
        invalidationTransitionCount: invalidations,
        fatalReason,
        health,
        healthReasons: reasons,
        opportunityOutcome,
      });
    },
  };
}
