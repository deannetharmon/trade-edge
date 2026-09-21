// lib/ai-policy/freshness.ts
//
// Source-specific as-of / max-age evaluation. Each source declares its own maximum age (config.ts). A source that is
// missing, unparsable, in the future beyond a small clock skew, older than its maximum, or without a maximum is not fresh.

import { maxAgeSeconds } from './config';
import type { SourceKind } from './types';

export type FreshnessState = 'fresh' | 'stale' | 'missing';

export interface SourceFreshness {
  source: SourceKind;
  state: FreshnessState;
  asOf: string | null;
  ageSeconds: number | null;
  maxAgeSeconds: number | null;
}

const CLOCK_SKEW_MS = 60_000;

export function evaluateSource(
  source: SourceKind,
  asOf: string | null | undefined,
  nowMs: number,
  maxAgeLookup: (s: SourceKind) => number | null = maxAgeSeconds,
): SourceFreshness {
  const max = maxAgeLookup(source);
  if (asOf == null || asOf === '') return { source, state: 'missing', asOf: null, ageSeconds: null, maxAgeSeconds: max };
  const t = Date.parse(asOf);
  if (!Number.isFinite(t)) return { source, state: 'missing', asOf: null, ageSeconds: null, maxAgeSeconds: max };
  const ageSeconds = Math.floor((nowMs - t) / 1000);
  if (max == null || t - nowMs > CLOCK_SKEW_MS || ageSeconds > max) return { source, state: 'stale', asOf, ageSeconds, maxAgeSeconds: max };
  return { source, state: 'fresh', asOf, ageSeconds, maxAgeSeconds: max };
}

export interface FreshnessReport {
  perSource: SourceFreshness[];
  /** Sources that are missing or stale. */
  notFresh: SourceFreshness[];
  allFresh: boolean;
}

export function evaluateFreshness(
  sourceAsOf: Partial<Record<SourceKind, string | null>>,
  required: readonly SourceKind[],
  nowMs: number,
  maxAgeLookup?: (s: SourceKind) => number | null,
): FreshnessReport {
  const perSource = required.map((s) => evaluateSource(s, sourceAsOf[s], nowMs, maxAgeLookup));
  const notFresh = perSource.filter((p) => p.state !== 'fresh');
  return { perSource, notFresh, allFresh: notFresh.length === 0 };
}
