// lib/discovery/metrics.ts

// LEAPS-QV-0001 Gate 1 (items 3-4, Sections 8-9) -- normalized metric contract and validity semantics.
//
// Every metric is exactly one of VALID / UNAVAILABLE / STALE / INVALID. Missing data never becomes zero,
// an average, "neutral", a pass or a fail: only a VALID metric exposes `value`. A STALE metric keeps its
// last-known number under `staleValue` so it can be shown, but it cannot be read as a usable value by accident.

import { isIsoTimestamp, uniqueSorted } from './util';
import type { JsonValue } from './util';

export type MetricValidity = 'VALID' | 'UNAVAILABLE' | 'STALE' | 'INVALID';

export const METRIC_VALIDITIES: readonly MetricValidity[] = ['VALID', 'UNAVAILABLE', 'STALE', 'INVALID'];

/** Optional pointer back to the provider field a metric was normalized from. Strategies never read it. */
export interface MetricProvenance {
  readonly provider: string;
  readonly field?: string;
}

export interface ValidMetric<T extends JsonValue> {
  readonly id: string;
  readonly validity: 'VALID';
  readonly value: T;
  readonly asOf: string;
  readonly provenance?: MetricProvenance;
}

export interface StaleMetric<T extends JsonValue> {
  readonly id: string;
  readonly validity: 'STALE';
  readonly staleValue: T;
  readonly asOf: string;
  readonly ageMs: number;
  readonly maxAgeMs: number;
  readonly provenance?: MetricProvenance;
}

export interface UnavailableMetric {
  readonly id: string;
  readonly validity: 'UNAVAILABLE';
  readonly reason?: string;
  readonly provenance?: MetricProvenance;
}

export interface InvalidMetric {
  readonly id: string;
  readonly validity: 'INVALID';
  /** Text rendering of what the provider sent, so audit trails survive without carrying a bad number forward. */
  readonly rejectedValue: string;
  readonly reason: string;
  readonly provenance?: MetricProvenance;
}

export type NormalizedMetric<T extends JsonValue = JsonValue> =
  | ValidMetric<T>
  | StaleMetric<T>
  | UnavailableMetric
  | InvalidMetric;

export type MetricSet = Readonly<Record<string, NormalizedMetric>>;

const METRIC_ID = /^[a-z][a-z0-9_]*$/;

export function assertMetricId(id: string): void {
  if (!METRIC_ID.test(id)) {
    throw new Error(`Invalid metric id "${id}": expected lower_snake_case starting with a letter.`);
  }
}

// ---------------------------------------------------------------------------
// Constructors (for adapters that already know the validity)
// ---------------------------------------------------------------------------

export function validMetric<T extends JsonValue>(
  id: string,
  value: T,
  asOf: string,
  provenance?: MetricProvenance,
): ValidMetric<T> {
  assertMetricId(id);
  if (!isIsoTimestamp(asOf)) throw new Error(`Metric "${id}": asOf must be an ISO-8601 timestamp.`);
  if (value === null || (typeof value === 'number' && !Number.isFinite(value))) {
    throw new Error(`Metric "${id}": null / non-finite values are not VALID; use unavailableMetric or invalidMetric.`);
  }
  return Object.freeze({ id, validity: 'VALID' as const, value, asOf, ...(provenance ? { provenance } : {}) });
}

export function unavailableMetric(id: string, reason?: string, provenance?: MetricProvenance): UnavailableMetric {
  assertMetricId(id);
  return Object.freeze({
    id,
    validity: 'UNAVAILABLE' as const,
    ...(reason ? { reason } : {}),
    ...(provenance ? { provenance } : {}),
  });
}

export function staleMetric<T extends JsonValue>(
  id: string,
  staleValue: T,
  asOf: string,
  ageMs: number,
  maxAgeMs: number,
  provenance?: MetricProvenance,
): StaleMetric<T> {
  assertMetricId(id);
  if (!isIsoTimestamp(asOf)) throw new Error(`Metric "${id}": asOf must be an ISO-8601 timestamp.`);
  if (!(ageMs > maxAgeMs)) throw new Error(`Metric "${id}": a STALE metric must be older than its maximum age.`);
  return Object.freeze({
    id,
    validity: 'STALE' as const,
    staleValue,
    asOf,
    ageMs,
    maxAgeMs,
    ...(provenance ? { provenance } : {}),
  });
}

export function invalidMetric(
  id: string,
  rejected: unknown,
  reason: string,
  provenance?: MetricProvenance,
): InvalidMetric {
  assertMetricId(id);
  return Object.freeze({
    id,
    validity: 'INVALID' as const,
    rejectedValue: describeRejected(rejected),
    reason,
    ...(provenance ? { provenance } : {}),
  });
}

function describeRejected(rejected: unknown): string {
  if (typeof rejected === 'string') return rejected.slice(0, 200);
  if (typeof rejected === 'number' || typeof rejected === 'boolean' || rejected === null || rejected === undefined) {
    return String(rejected);
  }
  try {
    return JSON.stringify(rejected).slice(0, 200);
  } catch {
    return Object.prototype.toString.call(rejected);
  }
}

// ---------------------------------------------------------------------------
// Normalization of raw provider values
// ---------------------------------------------------------------------------

export type CoerceResult<T extends JsonValue> = { ok: true; value: T } | { ok: false; reason: string };

export interface NormalizeContext<T extends JsonValue> {
  /** When the provider observed the value. Absent -> the value cannot be proven current, so it is INVALID. */
  asOf: string | null | undefined;
  /** The evaluation instant (injected -- the engine never reads the clock). */
  now: string;
  /** Maximum acceptable age. Omit when the metric has no freshness requirement. */
  maxAgeMs?: number;
  provenance?: MetricProvenance;
  /** Converts the raw provider value, or rejects it with a reason. */
  coerce: (raw: unknown) => CoerceResult<T>;
}

/**
 * Provider value -> NormalizedMetric. Decision order:
 *   null / undefined / ''        -> UNAVAILABLE   (never zero)
 *   coerce rejects the value     -> INVALID
 *   no/invalid asOf, asOf > now  -> INVALID
 *   older than maxAgeMs          -> STALE
 *   otherwise                    -> VALID
 */
export function normalizeMetric<T extends JsonValue>(
  id: string,
  raw: unknown,
  context: NormalizeContext<T>,
): NormalizedMetric<T> {
  assertMetricId(id);
  const { provenance } = context;
  if (raw === null || raw === undefined || raw === '') {
    return unavailableMetric(id, 'NOT_PROVIDED', provenance);
  }
  const coerced = context.coerce(raw);
  if (!coerced.ok) return invalidMetric(id, raw, coerced.reason, provenance);

  if (!isIsoTimestamp(context.now)) throw new Error('normalizeMetric: now must be an ISO-8601 timestamp.');
  if (!isIsoTimestamp(context.asOf)) return invalidMetric(id, raw, 'MISSING_OR_INVALID_AS_OF', provenance);

  const ageMs = Date.parse(context.now) - Date.parse(context.asOf);
  if (ageMs < 0) return invalidMetric(id, raw, 'AS_OF_IN_FUTURE', provenance);
  if (context.maxAgeMs !== undefined && ageMs > context.maxAgeMs) {
    return staleMetric(id, coerced.value, context.asOf, ageMs, context.maxAgeMs, provenance);
  }
  return validMetric(id, coerced.value, context.asOf, provenance);
}

export interface NumberNormalizeContext {
  asOf: string | null | undefined;
  now: string;
  maxAgeMs?: number;
  provenance?: MetricProvenance;
  /**
   * Optional provider-domain check (e.g. "a share price must be positive"). Return a reason to reject.
   * This is a data-sanity hook, not an investment rule.
   */
  rejectIf?: (value: number) => string | null;
}

/** Finite JavaScript numbers only. Numeric strings are rejected: coercion belongs in the provider adapter. */
export function normalizeNumberMetric(
  id: string,
  raw: unknown,
  context: NumberNormalizeContext,
): NormalizedMetric<number> {
  return normalizeMetric<number>(id, raw, {
    asOf: context.asOf,
    now: context.now,
    maxAgeMs: context.maxAgeMs,
    provenance: context.provenance,
    coerce: (value) => {
      if (typeof value !== 'number') return { ok: false, reason: 'NOT_A_NUMBER_TYPE' };
      if (!Number.isFinite(value)) return { ok: false, reason: 'NON_FINITE_NUMBER' };
      const rejection = context.rejectIf ? context.rejectIf(value) : null;
      return rejection ? { ok: false, reason: rejection } : { ok: true, value };
    },
  });
}

// ---------------------------------------------------------------------------
// Access helpers
// ---------------------------------------------------------------------------

export function isValidMetric<T extends JsonValue>(metric: NormalizedMetric<T>): metric is ValidMetric<T> {
  return metric.validity === 'VALID';
}

/** A metric the caller did not supply at all is UNAVAILABLE -- never a default value. */
export function getMetric(set: MetricSet, id: string): NormalizedMetric {
  return Object.prototype.hasOwnProperty.call(set, id) ? set[id] : unavailableMetric(id, 'NOT_IN_METRIC_SET');
}

// ---------------------------------------------------------------------------
// Criterion evaluation: fail vs. inability to evaluate
// ---------------------------------------------------------------------------

export type CriterionResult = 'PASS' | 'FAIL' | 'NOT_EVALUABLE';

export interface CriterionEvaluation {
  readonly criterionId: string;
  readonly result: CriterionResult;
  /** Inputs that prevented evaluation (empty unless result is NOT_EVALUABLE). */
  readonly blockingMetrics: ReadonlyArray<{ readonly id: string; readonly validity: MetricValidity }>;
}

/**
 * Evaluates a criterion only when EVERY input is VALID. If any input is UNAVAILABLE / STALE / INVALID the
 * result is NOT_EVALUABLE and `test` is never called -- the criterion neither passes nor fails.
 */
export function evaluateCriterion(
  criterionId: string,
  inputs: readonly NormalizedMetric[],
  test: (valid: ReadonlyArray<ValidMetric<JsonValue>>) => boolean,
): CriterionEvaluation {
  const blocking = inputs
    .filter((metric) => metric.validity !== 'VALID')
    .map((metric) => ({ id: metric.id, validity: metric.validity }));
  if (blocking.length > 0 || inputs.length === 0) {
    return Object.freeze({ criterionId, result: 'NOT_EVALUABLE' as const, blockingMetrics: Object.freeze(blocking) });
  }
  const valid = inputs as ReadonlyArray<ValidMetric<JsonValue>>;
  return Object.freeze({
    criterionId,
    result: test(valid) ? ('PASS' as const) : ('FAIL' as const),
    blockingMetrics: Object.freeze([]),
  });
}

// ---------------------------------------------------------------------------
// Data completeness (Section 9) -- separate from investment quality
// ---------------------------------------------------------------------------

export interface DataCompleteness {
  readonly requiredCount: number;
  readonly validCount: number;
  readonly unavailableCount: number;
  readonly staleCount: number;
  readonly invalidCount: number;
  /** Critical metric ids that are not VALID, sorted. Non-empty -> ACTIONABLE must be withheld by the strategy. */
  readonly criticalMissing: readonly string[];
  /** Every required metric is VALID. */
  readonly complete: boolean;
  /** Every critical metric is VALID. */
  readonly criticalComplete: boolean;
}

/** Critical ids are implicitly required. */
export function summarizeDataCompleteness(
  set: MetricSet,
  requiredIds: readonly string[],
  criticalIds: readonly string[] = [],
): DataCompleteness {
  const required = uniqueSorted([...requiredIds, ...criticalIds]);
  let valid = 0;
  let unavailable = 0;
  let stale = 0;
  let invalid = 0;
  required.forEach((id) => {
    switch (getMetric(set, id).validity) {
      case 'VALID':
        valid += 1;
        break;
      case 'UNAVAILABLE':
        unavailable += 1;
        break;
      case 'STALE':
        stale += 1;
        break;
      default:
        invalid += 1;
    }
  });
  const criticalMissing = uniqueSorted(criticalIds).filter((id) => getMetric(set, id).validity !== 'VALID');
  return Object.freeze({
    requiredCount: required.length,
    validCount: valid,
    unavailableCount: unavailable,
    staleCount: stale,
    invalidCount: invalid,
    criticalMissing: Object.freeze(criticalMissing),
    complete: valid === required.length,
    criticalComplete: criticalMissing.length === 0,
  });
}

export interface MetricValidityCounts {
  readonly VALID: number;
  readonly UNAVAILABLE: number;
  readonly STALE: number;
  readonly INVALID: number;
}

export function countMetricValidity(set: MetricSet): MetricValidityCounts {
  const counts = { VALID: 0, UNAVAILABLE: 0, STALE: 0, INVALID: 0 };
  Object.keys(set).forEach((id) => {
    counts[set[id].validity] += 1;
  });
  return counts;
}
