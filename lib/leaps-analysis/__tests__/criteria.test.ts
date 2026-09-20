// lib/leaps-analysis/__tests__/criteria.test.ts
//
// LEAPS-AI-0003 -- resolveLeapsCriteria is the former trade-review `resolveCriteria`, moved unchanged.
// `legacyResolveCriteria` below is a verbatim copy of that function as it existed before the move; the
// golden test proves the moved function returns identical criteria for every input in the battery.

import { describe, expect, it } from 'vitest';
import { resolveAnalysisCriteria, resolveLeapsCriteria } from '../criteria';
import { SERVER_LEAPS_POLICY } from '../serverTradeReview';
import type { LeapsEntryCriteria } from '@/lib/scans/leapsEntryQualification';

function legacyFiniteInRange(value: unknown, min: number, max: number): number | null {
  const n = Number(value);
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
}

function legacyResolveCriteria(body: any): LeapsEntryCriteria {
  const deltaMin = legacyFiniteInRange(body?.deltaMin, 0, 1) ?? SERVER_LEAPS_POLICY.deltaMin;
  const deltaMax = legacyFiniteInRange(body?.deltaMax, 0, 1) ?? SERVER_LEAPS_POLICY.deltaMax;
  const dteMin = legacyFiniteInRange(body?.dteMin, 0, 5000) ?? SERVER_LEAPS_POLICY.dteMin;
  const dteMax = legacyFiniteInRange(body?.dteMax, 0, 5000) ?? undefined;
  const oiMin = legacyFiniteInRange(body?.oiMin, 0, 1_000_000) ?? SERVER_LEAPS_POLICY.oiMin;
  const extrinsicPctMax = body?.extrinsicPctMax === 0 || body?.extrinsicPctMax == null
    ? null
    : legacyFiniteInRange(body.extrinsicPctMax, 0, 1000) ?? SERVER_LEAPS_POLICY.extrinsicPctMax;
  return { ...SERVER_LEAPS_POLICY, deltaMin, deltaMax, dteMin, dteMax, oiMin, extrinsicPctMax };
}

const BATTERY: unknown[] = [
  undefined, null, {}, 'text', 7,
  { deltaMin: 0.6 }, { deltaMin: '0.6' }, { deltaMin: -1 }, { deltaMin: 2 }, { deltaMin: null }, { deltaMin: 'abc' },
  { deltaMax: 0 }, { deltaMax: 1 }, { deltaMax: 1.01 },
  { dteMin: 0 }, { dteMin: 5000 }, { dteMin: 5001 }, { dteMin: 365 },
  { dteMax: 0 }, { dteMax: 400 }, { dteMax: 5000 }, { dteMax: 9999 }, { dteMax: 'x' },
  { oiMin: 0 }, { oiMin: 250 }, { oiMin: 1_000_000 }, { oiMin: 1_000_001 },
  { extrinsicPctMax: 0 }, { extrinsicPctMax: null }, { extrinsicPctMax: 15 }, { extrinsicPctMax: 25.5 }, { extrinsicPctMax: 1000 }, { extrinsicPctMax: 1001 }, { extrinsicPctMax: 'abc' }, { extrinsicPctMax: -5 },
  { deltaMin: 0.6, deltaMax: 0.9, dteMin: 200, dteMax: 700, oiMin: 50, extrinsicPctMax: 12 },
  { deltaMin: 0.7, deltaMax: 0.85, dteMin: 180, dteMax: 730, oiMin: 100, extrinsicPctMax: 0 },
];

describe('resolveLeapsCriteria', () => {
  it('matches the pre-move trade-review function for every input in the battery', () => {
    for (const input of BATTERY) expect(resolveLeapsCriteria(input), JSON.stringify(input)).toEqual(legacyResolveCriteria(input));
  });

  it('falls back to the server policy for missing or out-of-range values and treats 0/omitted extrinsic as "Any"', () => {
    const criteria = resolveLeapsCriteria({ deltaMin: 5, oiMin: -1, extrinsicPctMax: 0 });
    expect(criteria.deltaMin).toBe(SERVER_LEAPS_POLICY.deltaMin);
    expect(criteria.oiMin).toBe(SERVER_LEAPS_POLICY.oiMin);
    expect(criteria.extrinsicPctMax).toBeNull();
    expect(criteria.dteMax).toBeUndefined();
  });

  it('never exposes spread or freshness as adjustable', () => {
    const criteria = resolveLeapsCriteria({ spreadPctMax: 99, requireQuoteTimestamp: false });
    expect(criteria.spreadPctMax).toBe(SERVER_LEAPS_POLICY.spreadPctMax);
    expect(criteria.requireQuoteTimestamp).toBe(true);
  });
});

describe('resolveAnalysisCriteria', () => {
  it('keeps the fixed server policy when the request carries no filter fields', () => {
    for (const body of [undefined, null, {}, 'text', { intent: 'standalone', quantity: 1 }]) {
      const result = resolveAnalysisCriteria(body);
      expect(result.source).toBe('server_default');
      expect(result.criteria).toEqual(SERVER_LEAPS_POLICY);
    }
  });

  it('uses the trader\'s scan filters when any filter field is present', () => {
    const result = resolveAnalysisCriteria({ deltaMin: 0.6, deltaMax: 0.9, dteMin: 200, dteMax: 700, oiMin: 50, extrinsicPctMax: 12 });
    expect(result.source).toBe('scan_filters');
    expect(result.criteria).toMatchObject({ deltaMin: 0.6, deltaMax: 0.9, dteMin: 200, dteMax: 700, oiMin: 50, extrinsicPctMax: 12 });
  });

  it('treats a lone filter field as scan filters (remaining fields follow the order-gate rule)', () => {
    const result = resolveAnalysisCriteria({ deltaMin: 0.6 });
    expect(result.source).toBe('scan_filters');
    expect(result.criteria.extrinsicPctMax).toBeNull();
  });
});
