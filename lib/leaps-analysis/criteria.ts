// lib/leaps-analysis/criteria.ts
//
// LEAPS-AI-0003 -- the single home for turning the trader's live LEAPS scan
// filters into server-side qualification criteria.
//
// resolveLeapsCriteria() is the function that previously lived, unexported,
// inside app/api/leaps-analysis/trade-review/route.ts (Next.js route files
// cannot export helpers). Its behavior is unchanged: same fields, same bounds,
// same fallbacks. Both /api/leaps-analysis/trade-review (orders) and
// /api/leaps-analysis (Analyze with AI) now use it, so the gate the trader sees
// on the candidate row, the gate that blocks an order, and the gate the AI panel
// reports are the same gate.
//
// Anything not supplied (or outside the safe numeric bounds) falls back to
// SERVER_LEAPS_POLICY's value. spreadPctMax and the quote-freshness requirement
// stay fixed: they are data-integrity/safety checks, not screening preferences.

import type { LeapsEntryCriteria } from '@/lib/scans/leapsEntryQualification';
import { SERVER_LEAPS_POLICY } from './serverTradeReview';

export type LeapsCriteriaSource = 'scan_filters' | 'server_default';

export const LEAPS_FILTER_KEYS = ['deltaMin', 'deltaMax', 'dteMin', 'dteMax', 'oiMin', 'extrinsicPctMax'] as const;

function finiteInRange(value: unknown, min: number, max: number): number | null {
  const n = Number(value);
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
}

/** Unchanged behavior of the former trade-review `resolveCriteria`. */
export function resolveLeapsCriteria(body: any): LeapsEntryCriteria {
  const deltaMin = finiteInRange(body?.deltaMin, 0, 1) ?? SERVER_LEAPS_POLICY.deltaMin;
  const deltaMax = finiteInRange(body?.deltaMax, 0, 1) ?? SERVER_LEAPS_POLICY.deltaMax;
  const dteMin = finiteInRange(body?.dteMin, 0, 5000) ?? SERVER_LEAPS_POLICY.dteMin;
  const dteMax = finiteInRange(body?.dteMax, 0, 5000) ?? undefined;
  const oiMin = finiteInRange(body?.oiMin, 0, 1_000_000) ?? SERVER_LEAPS_POLICY.oiMin;
  const extrinsicPctMax = body?.extrinsicPctMax === 0 || body?.extrinsicPctMax == null
    ? null // 0/omitted means "Any" -- discovery mode, matches the UI's own convention
    : finiteInRange(body.extrinsicPctMax, 0, 1000) ?? SERVER_LEAPS_POLICY.extrinsicPctMax;
  return { ...SERVER_LEAPS_POLICY, deltaMin, deltaMax, dteMin, dteMax, oiMin, extrinsicPctMax };
}

/**
 * Criteria for Analyze with AI. A request that carries none of the six filter
 * fields (an older client) keeps today's behavior: the fixed server policy,
 * labelled 'server_default'. Any filter field present means the trader's scan
 * filters apply, resolved by the same function the order gate uses.
 */
export function resolveAnalysisCriteria(body: any): { criteria: LeapsEntryCriteria; source: LeapsCriteriaSource } {
  const supplied = body != null && typeof body === 'object' && LEAPS_FILTER_KEYS.some(key => body[key] !== undefined);
  return supplied
    ? { criteria: resolveLeapsCriteria(body), source: 'scan_filters' }
    : { criteria: { ...SERVER_LEAPS_POLICY }, source: 'server_default' };
}
