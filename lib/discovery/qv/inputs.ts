// lib/discovery/qv/inputs.ts

// LEAPS-QV-0001 Gate 3 -- how the QV-v1.0 classifiers read normalized metrics.
//
// A number is exposed ONLY from a VALID numeric metric. UNAVAILABLE / STALE / INVALID (or a VALID metric whose value is
// not a finite number) read as `value: null`, and the metric id is reported as the thing that blocked evaluation. There
// is no default, no neutral substitute and no fallback to a stale figure: missing evidence stays missing (Section 8).

import { getMetric } from '../metrics';
import type { MetricSet, NormalizedMetric } from '../metrics';
import type { ReasonCode } from '../reasonCodes';

export interface NumericRead {
  readonly id: string;
  readonly metric: NormalizedMetric;
  /** The number, or null when the metric is not a VALID finite number. */
  readonly value: number | null;
}

export function readNumber(set: MetricSet, id: string): NumericRead {
  const metric = getMetric(set, id);
  if (metric.validity === 'VALID' && typeof metric.value === 'number' && Number.isFinite(metric.value)) {
    return { id, metric, value: metric.value };
  }
  return { id, metric, value: null };
}

/** Metric ids whose reads carry no usable number, sorted and de-duplicated. */
export function blockingIds(reads: readonly NumericRead[]): string[] {
  const out: string[] = [];
  reads.forEach((read) => {
    if (read.value === null && out.indexOf(read.id) < 0) out.push(read.id);
  });
  return out.sort();
}

export function metricsOf(reads: ReadonlyArray<NumericRead | null>): NormalizedMetric[] {
  const out: NormalizedMetric[] = [];
  reads.forEach((read) => {
    if (read) out.push(read.metric);
  });
  return out;
}

/** What every component assessment hands back to the classifier. */
export interface ComponentTrace {
  /** Reasons that explain the component (same comparisons that produced its result). */
  readonly reasons: readonly ReasonCode[];
  /** Metric ids the component needs for the path it took (feeds Data Completeness). */
  readonly requiredMetricIds: readonly string[];
  /** Metric ids that prevented a reliable evaluation (empty when the component is evaluable). */
  readonly blockingMetricIds: readonly string[];
}

/** The optional FCF history metric: annual FCF numbers, oldest first. Anything else is not usable history. */
export function readFcfHistory(set: MetricSet, id: string, minPoints: number): { readonly id: string; readonly metric: NormalizedMetric; readonly points: readonly number[] | null } {
  const metric = getMetric(set, id);
  if (metric.validity !== 'VALID' || !Array.isArray(metric.value)) return { id, metric, points: null };
  const points: number[] = [];
  for (let i = 0; i < metric.value.length; i += 1) {
    const entry = metric.value[i];
    if (typeof entry !== 'number' || !Number.isFinite(entry)) return { id, metric, points: null };
    points.push(entry);
  }
  return { id, metric, points: points.length >= minPoints ? points : null };
}
