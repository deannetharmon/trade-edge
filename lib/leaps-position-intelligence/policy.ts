import type { LeapsMandate } from './types';
import { DEFAULT_PMCC_QUOTE_POLICY, DEFAULT_PMCC_SHORT_DELTA_RANGE, DEFAULT_PMCC_SHORT_OI_MIN } from '@/lib/scans/pmccConfig';
import { DEFAULT_PMCC_DTE_RANGES } from '@/lib/scans/pmccDteRanges';

export const LEAPS_POSITION_INTELLIGENCE_POLICY_VERSION = 'LEAPS-PI-1.1' as const;
export const BROKER_SNAPSHOT_MAX_AGE_MS = 5 * 60 * 1000;
export const QUOTE_MAX_AGE_MS = 2 * 60 * 1000;
export const EVENT_MAX_AGE_MS = 15 * 60 * 1000;
/** New LEAPS acquisition only; a held contract naturally ages below this. */
export const NEW_LEAPS_ENTRY_DTE = { min: 270, max: 720 } as const;
/** Existing holding management review threshold; never an auto-close. */
export const EXISTING_LEAPS_REVIEW_DTE = 180;
/** Active-cycle/revalidation buffer only; not a second new-cycle entry gate. */
export const ACTIVE_CYCLE_DTE_MIN = 120;
/** Adapter to the single shared PMCC policy source; never duplicate its thresholds. */
export const PMCC_SHORT_DTE_MIN = DEFAULT_PMCC_DTE_RANGES.shortMin;
export const PMCC_SHORT_DTE_MAX = DEFAULT_PMCC_DTE_RANGES.shortMax;
export const PMCC_SHORT_DELTA_MIN = DEFAULT_PMCC_SHORT_DELTA_RANGE.min;
export const PMCC_SHORT_DELTA_MAX = DEFAULT_PMCC_SHORT_DELTA_RANGE.max;
export const PMCC_SHORT_OI_MIN = DEFAULT_PMCC_SHORT_OI_MIN;
export const PMCC_SHORT_SPREAD_MAX = DEFAULT_PMCC_QUOTE_POLICY.qualifyingSpreadPctMax;
export const MIN_UPSIDE_PARTICIPATION: Record<LeapsMandate['posture'], number> = {
  'upside-first': 70,
  balanced: 55,
  'income-first': 40,
};

export function isFresh(asOf: string | null, now: string, maxAgeMs: number): boolean {
  if (!asOf) return false;
  const timestamp = Date.parse(asOf);
  const current = Date.parse(now);
  return Number.isFinite(timestamp) && Number.isFinite(current) && timestamp <= current && current - timestamp <= maxAgeMs;
}

export function hasTwoSidedNonCrossedQuote(bid: number | null, ask: number | null): bid is number {
  // A zero bid is not executable PMCC income; treat it as unavailable rather
  // than allowing a Review state with a fictional $0.00 credit.
  return bid != null && ask != null && Number.isFinite(bid) && Number.isFinite(ask) && bid > 0 && ask >= bid;
}
