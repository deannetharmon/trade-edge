// lib/scans/cspRuleSnapshot.ts
// CSP-WORKFLOW-0001 core-correction (BLOCKER-06) — the canonical, immutable
// CSP rule/config snapshot type. Schema v4 (CSP-WORKFLOW-0001's
// multi-candidate change) was shipped without this field, deferred on the
// premise that it depended on the not-yet-built CSP configuration modal —
// but every CSP session already applies a concrete, known rule set
// (DEFAULT_CSP_RULES today; a future modal's resolved rules later), so there
// is no reason a stable snapshot type can't exist now. Recording it on every
// CSP session lets a trader looking at old results answer "what rules
// produced this scan?" without having to trust that the rules haven't
// silently changed since. The later CSP configuration modal should populate
// this SAME type (with `source: 'user'`) rather than requiring another
// schema bump.
//
// Deliberately pure and framework-free.

import type { CspRulesType } from './constants';

export type CspRuleSnapshotSource = 'default' | 'user';
export type CspRankSort = 'score' | 'creditDollars' | 'rocPct' | 'otmPct' | 'pop' | 'relevantLegOI' | 'dte' | 'none';

export interface CspRuleSnapshot {
  mode: 'filter' | 'rank' | 'targeted';
  preset: string;
  ivrMin: number;
  ivrMax: number;
  deltaMin: number;
  deltaMax: number;
  dteMin: number;
  dteMax: number;
  oiMin: number;
  bidAskMax: number;
  popMin: number | null;
  otmMin: number | null;
  rocMin: number | null;
  rankPrimary: 'score';
  rankSecondary: CspRankSort;
  earningsPolicy: 'disqualify-within-expiration';
  /** ISO timestamp of when this snapshot was captured -- i.e. when the scan
   * that owns it started, never backfilled or fabricated for an older
   * cache (which fails closed on schemaVersion mismatch before this field
   * would ever need to be reconstructed -- see validateSessionData()). */
  capturedAt: string;
  /** 'default' for every session built from DEFAULT_CSP_RULES today;
   * 'user' reserved for the future CSP configuration modal, which should
   * populate this same type rather than requiring another schema bump. */
  source: CspRuleSnapshotSource;
}

// The single canonical builder -- every caller that needs to attach a rule
// snapshot to a session should go through this function rather than
// hand-assembling the object, so the field mapping from CspRulesType can
// never silently drift between call sites.
export function buildCspRuleSnapshot(
  rules: CspRulesType,
  options: {
    source?: CspRuleSnapshotSource;
    now?: Date;
    mode?: CspRuleSnapshot['mode'];
    preset?: string;
    popMin?: number | null;
    otmMin?: number | null;
    rocMin?: number | null;
    rankSecondary?: CspRankSort;
  } = {},
): CspRuleSnapshot {
  return {
    mode: options.mode ?? 'filter',
    preset: options.preset ?? 'balanced',
    ivrMin: rules.IVR_MIN,
    ivrMax: rules.IVR_MAX,
    deltaMin: rules.DELTA_MIN,
    deltaMax: rules.DELTA_MAX,
    dteMin: rules.DTE_MIN,
    dteMax: rules.DTE_MAX,
    oiMin: rules.OI_MIN,
    bidAskMax: rules.BID_ASK_MAX,
    popMin: options.popMin ?? null,
    otmMin: options.otmMin ?? null,
    rocMin: options.rocMin ?? null,
    rankPrimary: 'score',
    rankSecondary: options.mode === 'rank' ? (options.rankSecondary ?? 'none') : 'none',
    earningsPolicy: 'disqualify-within-expiration',
    capturedAt: (options.now ?? new Date()).toISOString(),
    source: options.source ?? 'default',
  };
}

// Structural validator used by lib/screener/scanSession.ts's
// validateSessionData() to fail closed on a malformed/tampered snapshot,
// without lib/screener needing to duplicate the field list.
export function isValidCspRuleSnapshot(value: unknown): value is CspRuleSnapshot {
  if (value == null || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  const numericFields = ['ivrMin', 'ivrMax', 'deltaMin', 'deltaMax', 'dteMin', 'dteMax', 'oiMin', 'bidAskMax'];
  for (const field of numericFields) {
    if (typeof v[field] !== 'number' || !Number.isFinite(v[field])) return false;
  }
  if ((v.ivrMin as number) < 0 || (v.ivrMax as number) > 100 || (v.ivrMax as number) <= (v.ivrMin as number)) return false;
  if ((v.deltaMin as number) < 0 || (v.deltaMax as number) > 1 || (v.deltaMax as number) <= (v.deltaMin as number)) return false;
  if ((v.dteMin as number) < 0 || (v.dteMax as number) <= (v.dteMin as number)) return false;
  if ((v.oiMin as number) < 0 || (v.bidAskMax as number) < 0) return false;
  if (v.mode !== 'filter' && v.mode !== 'rank' && v.mode !== 'targeted') return false;
  if (typeof v.preset !== 'string' || v.preset.length === 0) return false;
  for (const field of ['popMin', 'otmMin', 'rocMin']) {
    if (v[field] !== null && (typeof v[field] !== 'number' || !Number.isFinite(v[field]))) return false;
  }
  if (v.popMin !== null && ((v.popMin as number) < 0 || (v.popMin as number) > 100)) return false;
  if (v.otmMin !== null && (v.otmMin as number) < 0) return false;
  if (v.rocMin !== null && (v.rocMin as number) < 0) return false;
  const hasTarget = v.popMin !== null || v.otmMin !== null || v.rocMin !== null;
  if (v.mode === 'targeted' ? !hasTarget : hasTarget) return false;
  const rankSorts = new Set(['score', 'creditDollars', 'rocPct', 'otmPct', 'pop', 'relevantLegOI', 'dte', 'none']);
  if (v.rankPrimary !== 'score' || typeof v.rankSecondary !== 'string' || !rankSorts.has(v.rankSecondary)) return false;
  if (v.rankSecondary === 'score') return false;
  if (v.mode !== 'rank' && v.rankSecondary !== 'none') return false;
  if (v.earningsPolicy !== 'disqualify-within-expiration') return false;
  if (typeof v.capturedAt !== 'string' || v.capturedAt.length === 0) return false;
  if (v.source !== 'default' && v.source !== 'user') return false;
  return true;
}
