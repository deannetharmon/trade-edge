// lib/scans/pmccEarningsRemoval.ts

// SCAN-ALIGN-0001D: PMCC earnings removal. A hard EXCLUSION applied to short-leg candidates before
// pairing (a filter, not a qualification gate: the EARNINGS_BEFORE_SHORT_EXPIRY gate is a warning
// and warnings never affect qualification). A short is removed when T <= E <= X (see
// earningsExpiryZone.ts). The meta below rides on a ScreenResult so the held-mode banner and the
// result-count receipt can report exclusions.

import { classifyEarningsVsExpiry } from './earningsExpiryZone';
import { pmccDte } from './pmccPairing';

export interface PmccEarningsRemoval {
  /** Distinct short-call expiries-in-range legs removed for earnings (in the scan's short DTE range). */
  removedCount: number;
  /** The earnings date (validated YYYY-MM-DD) that caused the removal. */
  earningsDate: string;
  /** Every short call in the DTE range was removed (E is on or before every in-range expiry). */
  allShortsRemoved: boolean;
  /** Held-LEAP mode (a held long was matched). */
  heldMode: boolean;
  /** asOf was missing/unparseable/zoneless, so removal ran without a "today" lower bound. */
  asOfUnknown: boolean;
}

export interface EarningsPartition<T> {
  kept: T[];
  removed: T[];
  /** Shorts whose DTE is inside the scan's short range. */
  inRangeCount: number;
  removedInRangeCount: number;
  firstRemovedInRange: T | null;
  earningsDate: string | null;
  asOfUnknown: boolean;
}

export function partitionShortsByEarnings<T extends { expiration: string }>(
  shorts: readonly T[],
  earningsDate: unknown,
  asOfIso: string,
  dte: { shortMin: number; shortMax: number },
): EarningsPartition<T> {
  const asOf = new Date(asOfIso);
  const kept: T[] = [];
  const removed: T[] = [];
  let inRangeCount = 0;
  let removedInRangeCount = 0;
  let firstRemovedInRange: T | null = null;
  let normalizedEarnings: string | null = null;
  let asOfUnknown = false;
  shorts.forEach(leg => {
    const zone = classifyEarningsVsExpiry(earningsDate, leg.expiration, asOfIso);
    if (zone.earningsDate) normalizedEarnings = zone.earningsDate;
    if (zone.asOfUnknown) asOfUnknown = true;
    const legDte = pmccDte(leg.expiration, asOf);
    const inRange = legDte != null && legDte >= dte.shortMin && legDte <= dte.shortMax;
    if (inRange) inRangeCount += 1;
    if (zone.zone === 'exclude') {
      removed.push(leg);
      if (inRange) {
        removedInRangeCount += 1;
        if (firstRemovedInRange === null) firstRemovedInRange = leg;
      }
    } else {
      kept.push(leg);
    }
  });
  return { kept, removed, inRangeCount, removedInRangeCount, firstRemovedInRange, earningsDate: normalizedEarnings, asOfUnknown };
}

/** Receipt suffix for the result-count line, e.g. " · 3 short calls removed for earnings"; '' when none. */
export function earningsRemovalReceipt(results: readonly { pmccEarningsRemoval?: PmccEarningsRemoval }[]): string {
  let total = 0;
  results.forEach(result => { total += result.pmccEarningsRemoval?.removedCount ?? 0; });
  if (total <= 0) return '';
  return ` · ${total} short call${total === 1 ? '' : 's'} removed for earnings`;
}
