// lib/discovery/reasonCodes.ts

// LEAPS-QV-0001 Gate 1 (item 5, Section 22) -- structured reason codes.
//
// A reason is data, not prose: a code, its category and polarity, and the metric evidence it rests on.
// Human-readable text is derived FROM that structure (explainReason), so a UI explanation can never drift
// from the evidence the strategy actually used. Gate 1 defines the model and the data-limitation reasons the
// framework itself can emit; investment reason codes (QUALITY_*, VALUATION_*, ...) arrive with their gates.

import type { MetricValidity, NormalizedMetric } from './metrics';
import type { JsonObject, JsonValue } from './util';

export const REASON_CATEGORIES = [
  'QUALITY',
  'VALUATION',
  'FUNDAMENTAL',
  'TECHNICAL',
  'RISK',
  'DATA',
  'LEAPS',
  'LIFECYCLE',
] as const;

export type ReasonCategory = (typeof REASON_CATEGORIES)[number];

/**
 * SUPPORTS     -- evidence in favour of the thesis
 * CONCERN      -- evidence against it, or a limitation worth showing
 * BLOCKING     -- a required criterion failed / could not be evaluated
 * INFORMATIONAL-- context that does not push the decision either way
 */
export type ReasonPolarity = 'SUPPORTS' | 'CONCERN' | 'BLOCKING' | 'INFORMATIONAL';

export const REASON_POLARITIES: readonly ReasonPolarity[] = ['SUPPORTS', 'CONCERN', 'BLOCKING', 'INFORMATIONAL'];

export interface ReasonEvidence {
  readonly metricId: string;
  readonly validity: MetricValidity;
  /** Present only for VALID metrics. Stale / invalid / unavailable numbers are never offered as evidence values. */
  readonly value?: JsonValue;
  readonly asOf?: string;
}

export interface ReasonCode {
  readonly code: string;
  readonly category: ReasonCategory;
  readonly polarity: ReasonPolarity;
  readonly evidence: readonly ReasonEvidence[];
  /** Structured extras (thresholds applied, counts, ...). Never free-text prose. */
  readonly params?: JsonObject;
}

const CODE_PATTERN = new RegExp(`^(${REASON_CATEGORIES.join('|')})_[A-Z0-9]+(?:_[A-Z0-9]+)*$`);

export function isReasonCode(code: string): boolean {
  return CODE_PATTERN.test(code);
}

export function categoryOfReasonCode(code: string): ReasonCategory {
  const match = CODE_PATTERN.exec(code);
  if (!match) {
    throw new Error(`Invalid reason code "${code}": expected <CATEGORY>_<UPPER_SNAKE>, category one of ${REASON_CATEGORIES.join(', ')}.`);
  }
  return match[1] as ReasonCategory;
}

export function evidenceFromMetric(metric: NormalizedMetric): ReasonEvidence {
  switch (metric.validity) {
    case 'VALID':
      return Object.freeze({ metricId: metric.id, validity: 'VALID' as const, value: metric.value, asOf: metric.asOf });
    case 'STALE':
      return Object.freeze({ metricId: metric.id, validity: 'STALE' as const, asOf: metric.asOf });
    default:
      return Object.freeze({ metricId: metric.id, validity: metric.validity });
  }
}

export interface CreateReasonInput {
  code: string;
  polarity: ReasonPolarity;
  evidence?: ReadonlyArray<NormalizedMetric | ReasonEvidence>;
  params?: JsonObject;
}

function isMetric(value: NormalizedMetric | ReasonEvidence): value is NormalizedMetric {
  return 'id' in value;
}

export function createReason(input: CreateReasonInput): ReasonCode {
  const category = categoryOfReasonCode(input.code);
  if (REASON_POLARITIES.indexOf(input.polarity) < 0) {
    throw new Error(`Invalid reason polarity "${String(input.polarity)}" for ${input.code}.`);
  }
  const evidence = (input.evidence || []).map((item) => (isMetric(item) ? evidenceFromMetric(item) : item));
  return Object.freeze({
    code: input.code,
    category,
    polarity: input.polarity,
    evidence: Object.freeze(evidence),
    ...(input.params ? { params: input.params } : {}),
  });
}

/**
 * The framework's own missing-data reason, e.g. DATA_ANALYST_REVISIONS_UNAVAILABLE for metric
 * `analyst_revisions`. Only non-VALID metrics have a data limitation to report.
 */
export function dataLimitationReason(metric: NormalizedMetric): ReasonCode {
  if (metric.validity === 'VALID') {
    throw new Error(`Metric "${metric.id}" is VALID; it has no data limitation to report.`);
  }
  return createReason({
    code: `DATA_${metric.id.toUpperCase()}_${metric.validity}`,
    polarity: 'CONCERN',
    evidence: [metric],
  });
}

// ---------------------------------------------------------------------------
// Deterministic ordering
// ---------------------------------------------------------------------------

/** Category order, then code, then polarity -- so identical evidence always yields an identical list. */
export function sortReasons(reasons: readonly ReasonCode[]): ReasonCode[] {
  return reasons.slice().sort((a, b) => {
    const byCategory = REASON_CATEGORIES.indexOf(a.category) - REASON_CATEGORIES.indexOf(b.category);
    if (byCategory !== 0) return byCategory;
    if (a.code !== b.code) return a.code < b.code ? -1 : 1;
    return REASON_POLARITIES.indexOf(a.polarity) - REASON_POLARITIES.indexOf(b.polarity);
  });
}

/** Drops exact duplicates (same code + polarity), keeping the first occurrence. */
export function dedupeReasons(reasons: readonly ReasonCode[]): ReasonCode[] {
  const seen: Record<string, true> = {};
  const out: ReasonCode[] = [];
  reasons.forEach((reason) => {
    const key = `${reason.code}|${reason.polarity}`;
    if (seen[key]) return;
    seen[key] = true;
    out.push(reason);
  });
  return out;
}

export function normalizeReasons(reasons: readonly ReasonCode[]): ReasonCode[] {
  return sortReasons(dedupeReasons(reasons));
}

// ---------------------------------------------------------------------------
// Explanations derived from the structured evidence
// ---------------------------------------------------------------------------

export type ReasonTemplates = Readonly<Record<string, (reason: ReasonCode) => string>>;

function humanizeCode(code: string): string {
  const words = code.split('_').map((word) => word.toLowerCase());
  const [category, ...rest] = words;
  return `${category.charAt(0).toUpperCase()}${category.slice(1)}: ${rest.join(' ')}`;
}

function describeEvidence(evidence: ReasonEvidence): string {
  return evidence.validity === 'VALID'
    ? `${evidence.metricId}=${JSON.stringify(evidence.value)}`
    : `${evidence.metricId} ${evidence.validity}`;
}

/**
 * Explains a reason using only its own fields. A strategy may supply per-code templates for nicer wording,
 * but templates receive the same ReasonCode object -- there is no second explanation algorithm.
 */
export function explainReason(reason: ReasonCode, templates?: ReasonTemplates): string {
  const template = templates && Object.prototype.hasOwnProperty.call(templates, reason.code) ? templates[reason.code] : null;
  if (template) return template(reason);
  const evidence = reason.evidence.map(describeEvidence).join(', ');
  const base = `${humanizeCode(reason.code)} [${reason.polarity.toLowerCase()}]`;
  return evidence ? `${base} (${evidence})` : base;
}

export function explainReasons(reasons: readonly ReasonCode[], templates?: ReasonTemplates): string[] {
  return reasons.map((reason) => explainReason(reason, templates));
}
