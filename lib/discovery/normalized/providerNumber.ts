// lib/discovery/normalized/providerNumber.ts

// LEAPS-QV-0001 Gate 2 -- provider boundary conversion (Quinn Gate 1: the framework rejects numeric strings;
// the adapters own provider-specific conversion). A provider may send a finite number or a plain decimal string.
// Anything else (including "N/A", "NaN", "12abc") is INVALID, never silently treated as zero or missing.
// Absent values (null / undefined / empty string) stay UNAVAILABLE.

import { normalizeNumberMetric } from '../metrics';
import type { NormalizedMetric, NumberNormalizeContext } from '../metrics';

const PLAIN_DECIMAL = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

export function providerNumber(id: string, raw: unknown, context: NumberNormalizeContext): NormalizedMetric<number> {
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (trimmed !== '' && PLAIN_DECIMAL.test(trimmed)) return normalizeNumberMetric(id, Number(trimmed), context);
  }
  return normalizeNumberMetric(id, raw, context);
}
