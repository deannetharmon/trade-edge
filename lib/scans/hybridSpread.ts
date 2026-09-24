// lib/scans/hybridSpread.ts
//
// SCAN-ALIGN-0001C2 -- the ONE bid/ask width policy shared by the covered-call scan
// (isEligibleCcLeg) and the PMCC scan (evaluatePmccQuoteQuality), so the two cannot drift.
//
// Hybrid rule (w = ask - bid, mid = (bid + ask) / 2):
//   reject  when w > max($0.05, rejectPct% of mid)          (strict >; equality passes)
//   warn    when w > max($0.05, warnPct%   of mid)          (only meaningful when not rejected)
//   ceiling when w > ceiling dollars per share              (short / covered-call legs only;
//                                                            callers pass null for everything else)
// Crossed quotes reject; a locked market (w = 0) passes; a missing/non-positive side rejects,
// so mid = 0 is unreachable. spreadPct stays a display-only number elsewhere.
//
// All comparisons are in integer 1e-4 dollar units (Math.round(x * 10000)) and the percent test
// is done by cross-multiplication against S = ask + bid (= 2 x mid), never a mid rounded to
// cents: 0.33 - 0.28 = 0.05000000000000004 in floats and must not reject.
//   w * 200 > max(200 * FLOOR, pct * S)     with FLOOR = 500 units ($0.05)
// which for pct = 10 is exactly the ticket's `20w > max(10000, S)` scaled by 10.

const UNITS_PER_DOLLAR = 10_000;
const ONE_TICK_FLOOR_UNITS = 500; // $0.05 -- a tick-noise allowance, not a quality signal

export type HybridSpreadStatus =
  | 'invalid_quote'
  | 'crossed'
  | 'too_wide'
  | 'over_ceiling'
  | 'wide_warning'
  | 'ok';

export interface HybridSpreadParams {
  /** Reject percent of mid (10 by default in both scans). */
  rejectPct: number;
  /** Warn percent of mid (5, fixed). */
  warnPct: number;
  /** Absolute reject ceiling, dollars per share. null/undefined = no ceiling (LEAP legs). */
  ceiling?: number | null;
}

export interface HybridSpreadResult {
  status: HybridSpreadStatus;
  reject: boolean;
  warn: boolean;
}

function finitePositive(value: number | null | undefined): value is number {
  return value != null && Number.isFinite(value) && value > 0;
}

const toUnits = (dollars: number): number => Math.round(dollars * UNITS_PER_DOLLAR);

const result = (status: HybridSpreadStatus): HybridSpreadResult => ({
  status,
  reject: status === 'invalid_quote' || status === 'crossed' || status === 'too_wide' || status === 'over_ceiling',
  warn: status === 'wide_warning',
});

export function evaluateHybridSpread(
  bid: number | null | undefined,
  ask: number | null | undefined,
  params: HybridSpreadParams,
): HybridSpreadResult {
  if (!finitePositive(bid) || !finitePositive(ask)) return result('invalid_quote');
  const bidU = toUnits(bid);
  const askU = toUnits(ask);
  if (askU < bidU) return result('crossed');

  const w = askU - bidU;
  const s = askU + bidU;

  // Fail closed on a nonsensical percent rather than letting NaN comparisons pass everything.
  if (!(Number.isFinite(params.rejectPct) && params.rejectPct >= 0)) return result('too_wide');
  if (w * 200 > Math.max(200 * ONE_TICK_FLOOR_UNITS, params.rejectPct * s)) return result('too_wide');

  const ceiling = params.ceiling;
  if (ceiling != null) {
    // A non-finite ceiling cannot be honoured; fail closed. Never clamp the ceiling up to the floor.
    if (!Number.isFinite(ceiling) || w > toUnits(ceiling)) return result('over_ceiling');
  }

  if (Number.isFinite(params.warnPct) && w * 200 > Math.max(200 * ONE_TICK_FLOOR_UNITS, params.warnPct * s)) {
    return result('wide_warning');
  }
  return result('ok');
}

// --- Covered-call width settings validation (SCAN-ALIGN-0001C2) ---------------------------------

export const CC_WIDTH_CEILING_MIN = 0.01; // one tick

export interface CcWidthSettings {
  WIDTH_PCT_MAX: number;
  WIDTH_CEILING: number;
}

/**
 * Validates the two covered-call width controls. A ceiling below the $0.05 floor (e.g. $0.03) is
 * valid: the effective limit is min(ceiling, reject rule) and the ceiling is never clamped up.
 * A ceiling must be finite and at least one tick ($0.01).
 */
export function validateCc(rules: Partial<CcWidthSettings>): Partial<Record<keyof CcWidthSettings, string>> {
  const errors: Partial<Record<keyof CcWidthSettings, string>> = {};
  const pct = rules.WIDTH_PCT_MAX;
  const ceiling = rules.WIDTH_CEILING;
  if (typeof pct !== 'number' || !Number.isFinite(pct)) errors.WIDTH_PCT_MAX = 'Enter a number.';
  else if (!(pct >= 0)) errors.WIDTH_PCT_MAX = 'Max width must be 0 or more.';
  if (typeof ceiling !== 'number' || !Number.isFinite(ceiling)) errors.WIDTH_CEILING = 'Enter a number.';
  else if (ceiling < 0) errors.WIDTH_CEILING = 'Width ceiling must be 0 or more.';
  else if (ceiling < CC_WIDTH_CEILING_MIN) errors.WIDTH_CEILING = 'Width ceiling must be at least $0.01.';
  return errors;
}
