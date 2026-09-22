// lib/screener/scanPreferences.ts
//
// SCREENER-PREFS-0001 -- user-scoped default values for scan and result
// filters. One JSON record per user in Redis, keyed screener:prefs:<userId>
// (Quinn, 2026-09-21). A missing key, or a missing field inside it, both mean
// "no preference set" -- callers fall back to the app's existing hardcoded
// default (Any/off), never an error and never a fabricated value.
//
// Scope, per the approved ticket:
//   - Global: dteMin, dteMax, oiMin, creditRatioMin, popMin, otmMin.
//   - Per-strategy: delta min/max for csp, ic, spreads (Ian: these reflect
//     real structural risk differences between strategies, not just taste,
//     so they are never shared).
//   - Per-launcher: default scan mode (csp, spreads -- the only two that
//     genuinely offer Rank/Targeted; cc and pmcc always use 'filter' by
//     design and have no mode preference to set, see SCREENER-CONFIG-0001).

import type { RedisLike } from '@/lib/ai-policy/types';

export type DeltaStrategy = 'csp' | 'ic' | 'spreads';
export type ModeStrategy = 'csp' | 'spreads';
export type ScanMode = 'rank' | 'targeted';

export interface DeltaRangePreference {
  min: number;
  max: number;
}

export interface ScanPreferences {
  dteMin: number | null;
  dteMax: number | null;
  oiMin: number | null;
  creditRatioMin: number | null;
  popMin: number | null;
  otmMin: number | null;
  delta: Partial<Record<DeltaStrategy, DeltaRangePreference>>;
  defaultMode: Partial<Record<ModeStrategy, ScanMode>>;
}

export const EMPTY_SCAN_PREFERENCES: ScanPreferences = {
  dteMin: null, dteMax: null, oiMin: null, creditRatioMin: null, popMin: null, otmMin: null,
  delta: {}, defaultMode: {},
};

const DELTA_STRATEGIES: readonly DeltaStrategy[] = ['csp', 'ic', 'spreads'];
const MODE_STRATEGIES: readonly ModeStrategy[] = ['csp', 'spreads'];
const MAX_VALUE = 100_000;

export const scanPrefsKey = (userId: string): string => `screener:prefs:${userId}`;

function isPositiveOrZero(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= MAX_VALUE;
}

/** A null field means "cleared, use the app default" -- distinct from a missing field, which means the same thing on read. Both are valid. */
function validateNumberField(v: unknown): number | null | undefined {
  if (v === null) return null;
  if (isPositiveOrZero(v)) return v;
  return undefined; // invalid: caller drops the field rather than trusting a bad value
}

function validateDeltaRange(v: unknown): DeltaRangePreference | undefined {
  if (typeof v !== 'object' || v === null) return undefined;
  const { min, max } = v as Record<string, unknown>;
  if (typeof min !== 'number' || typeof max !== 'number' || !Number.isFinite(min) || !Number.isFinite(max)) return undefined;
  if (min < 0 || max > 1 || min > max) return undefined; // delta is always a 0-1 magnitude
  return { min, max };
}

/**
 * Parses and validates an arbitrary stored/submitted value into a well-formed
 * ScanPreferences record. Never throws; anything malformed for one field is
 * simply dropped (falls back to null/absent for that field only), so a
 * partially-corrupt record never blocks the rest of a user's preferences.
 */
export function parseScanPreferences(value: unknown): ScanPreferences {
  const out: ScanPreferences = { ...EMPTY_SCAN_PREFERENCES, delta: {}, defaultMode: {} };
  if (typeof value !== 'object' || value === null) return out;
  const record = value as Record<string, unknown>;

  for (const field of ['dteMin', 'dteMax', 'oiMin', 'creditRatioMin', 'popMin', 'otmMin'] as const) {
    const parsed = validateNumberField(record[field]);
    if (parsed !== undefined) out[field] = parsed;
  }
  if (out.dteMin != null && out.dteMax != null && out.dteMin > out.dteMax) {
    out.dteMin = null;
    out.dteMax = null; // an inverted range is invalid data, not a usable preference
  }

  const delta = record.delta;
  if (typeof delta === 'object' && delta !== null) {
    for (const strategy of DELTA_STRATEGIES) {
      const parsed = validateDeltaRange((delta as Record<string, unknown>)[strategy]);
      if (parsed) out.delta[strategy] = parsed;
    }
  }

  const defaultMode = record.defaultMode;
  if (typeof defaultMode === 'object' && defaultMode !== null) {
    for (const strategy of MODE_STRATEGIES) {
      const mode = (defaultMode as Record<string, unknown>)[strategy];
      if (mode === 'rank' || mode === 'targeted') out.defaultMode[strategy] = mode;
    }
  }

  return out;
}

export async function readScanPreferences(redis: RedisLike, userId: string): Promise<ScanPreferences> {
  try {
    const raw = await redis.get(scanPrefsKey(userId));
    if (raw == null) return { ...EMPTY_SCAN_PREFERENCES, delta: {}, defaultMode: {} };
    return parseScanPreferences(JSON.parse(raw));
  } catch {
    // Malformed or unreadable data is treated exactly like "no preferences set" -- never an error surfaced to the scan UI.
    return { ...EMPTY_SCAN_PREFERENCES, delta: {}, defaultMode: {} };
  }
}

export type SaveScanPreferencesResult = { ok: true; preferences: ScanPreferences } | { ok: false; reason: string };

/**
 * Merges `patch` into the user's existing stored preferences (does not
 * require the caller to resend every field) and saves the result. A field
 * set to `null` in the patch clears that preference back to the app default;
 * a field simply absent from the patch is left unchanged.
 */
export async function saveScanPreferences(redis: RedisLike, userId: string, patch: unknown): Promise<SaveScanPreferencesResult> {
  if (typeof patch !== 'object' || patch === null || Array.isArray(patch)) return { ok: false, reason: 'A preferences object is required.' };
  const existing = await readScanPreferences(redis, userId);
  const merged: Record<string, unknown> = { ...existing };
  const patchRecord = patch as Record<string, unknown>;
  for (const field of ['dteMin', 'dteMax', 'oiMin', 'creditRatioMin', 'popMin', 'otmMin'] as const) {
    if (field in patchRecord) merged[field] = patchRecord[field];
  }
  if ('delta' in patchRecord && typeof patchRecord.delta === 'object' && patchRecord.delta !== null) {
    merged.delta = { ...existing.delta, ...(patchRecord.delta as Record<string, unknown>) };
  }
  if ('defaultMode' in patchRecord && typeof patchRecord.defaultMode === 'object' && patchRecord.defaultMode !== null) {
    merged.defaultMode = { ...existing.defaultMode, ...(patchRecord.defaultMode as Record<string, unknown>) };
  }
  const preferences = parseScanPreferences(merged);
  await redis.set(scanPrefsKey(userId), JSON.stringify(preferences));
  return { ok: true, preferences };
}
