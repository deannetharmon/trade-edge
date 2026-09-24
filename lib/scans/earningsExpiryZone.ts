// lib/scans/earningsExpiryZone.ts

// SCAN-ALIGN-0001D: the one shared, pure classifier of an earnings date against a short-call
// expiry. E = earnings date, T = today (New York date derived from asOf), X = short expiry.
//
//   E < T                        past        pass, silent
//   T <= E <= X                  exclude     removed from results (a filter, never a gate)
//   X < E <= X + 5 NYSE bdays    warn-after  ambient tag only; never affects qualification or ranking
//   E > X + 5 NYSE bdays         clear       silent
//
// All comparisons are on validated ISO YYYY-MM-DD strings (never local-time Date math, never
// daysUntil). Malformed/missing E = 'no-date' (no exclusion); malformed/missing X = 'no-gate'.
// Missing or zoneless asOf: T is unknown, the lower bound is skipped, and E <= X still excludes
// (fail toward exclusion, Ian Q2); `asOfUnknown` lets the caller log/flag it.

import { newYorkDateFromAsOf, normalizeEarningsDate, parseStrictIsoDate } from './pmccEarningsDates';
import { addNyseBusinessDays, countNyseBusinessDaysAfter } from './nyseCalendar';

/** Named constant, not a scan control (Ian). */
export const EARNINGS_AFTER_EXPIRY_WINDOW_BD = 5;

export type EarningsExpiryZone = 'no-date' | 'no-gate' | 'past' | 'exclude' | 'warn-after' | 'clear';

export interface EarningsExpiryResult {
  zone: EarningsExpiryZone;
  earningsDate: string | null;
  expiration: string | null;
  today: string | null;
  /** True when asOf was missing/unparseable/zoneless, so T is unknown. */
  asOfUnknown: boolean;
  /** NYSE business days in (X, E]; only set for 'warn-after' (0 when E falls on a non-business day right after X). */
  businessDaysAfter: number | null;
}

export function classifyEarningsVsExpiry(earningsDate: unknown, expiration: unknown, asOf: unknown): EarningsExpiryResult {
  const e = normalizeEarningsDate(earningsDate);
  const x = parseStrictIsoDate(expiration);
  const today = newYorkDateFromAsOf(asOf);
  const base = { earningsDate: e, expiration: x, today, asOfUnknown: today === null, businessDaysAfter: null };
  if (!e) return { ...base, zone: 'no-date' };
  if (!x) return { ...base, zone: 'no-gate' };
  if (today !== null && e < today) return { ...base, zone: 'past' };
  if (e <= x) return { ...base, zone: 'exclude' };
  const windowEnd = addNyseBusinessDays(x, EARNINGS_AFTER_EXPIRY_WINDOW_BD);
  if (e <= windowEnd) return { ...base, zone: 'warn-after', businessDaysAfter: countNyseBusinessDaysAfter(x, e) };
  return { ...base, zone: 'clear' };
}

/** Ambient tag copy. N = 0 (earnings on a non-business day just after expiry) is "after expiry", never "0 bd". */
export function earningsAfterExpiryTag(businessDaysAfter: number | null | undefined): string {
  return typeof businessDaysAfter === 'number' && Number.isFinite(businessDaysAfter) && businessDaysAfter >= 1
    ? `Earnings ${businessDaysAfter} bd after expiry`
    : 'Earnings after expiry';
}
