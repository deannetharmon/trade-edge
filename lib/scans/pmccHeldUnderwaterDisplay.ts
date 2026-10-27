// lib/scans/pmccHeldUnderwaterDisplay.ts
//
// PMCC-HELD-UNDERWATER-0001A: pure display selectors for held LEAPs that are out of the money or below cost.
// No React, no I/O, and no qualification decision lives here: this file only chooses words.
//
//   - heldLeapOtmTag            "OTM LEAP · Δ0.45" chip text (null when the LEAP is in the money)
//   - selectLongLegBlockerLine  a separate long-leg line so an earnings or delta banner never hides it
//   - excludedContractPremiumText  premium shown next to an excluded contract in the chain-exclusion list

import { summarizePmccLegRejections } from './pmccAuditSummary';
import type { PmccLegRejection, PmccPairingCounts } from './pmccTypes';

/** Chip text for a held LEAP whose strike is at or above the stock price, else null. Wording reuses the
 * existing "Held LEAP" chip vocabulary (Diane: one name per concept). */
export function heldLeapOtmTag(strike: number | null | undefined, spot: number | null | undefined, delta: number | null | undefined): string | null {
  if (typeof strike !== 'number' || !Number.isFinite(strike)) return null;
  if (typeof spot !== 'number' || !Number.isFinite(spot) || spot <= 0) return null;
  if (!(strike >= spot)) return null;
  const deltaText = typeof delta === 'number' && Number.isFinite(delta) ? ` · Δ${Math.abs(delta).toFixed(2)}` : '';
  return `OTM LEAP${deltaText}`;
}

/**
 * One line naming why no long leg was eligible, or null. Only when the pairing found zero eligible
 * longs and at least one long was excluded with a reason. The grouped message is the engine's own text,
 * so this never invents a reason.
 */
export function selectLongLegBlockerLine(
  rejections: readonly PmccLegRejection[] | null | undefined,
  counts: Pick<PmccPairingCounts, 'eligibleLongLegs'> | null | undefined,
): string | null {
  if (!counts || counts.eligibleLongLegs > 0) return null;
  const longs = (rejections ?? []).filter(item => item.role === 'long');
  if (longs.length === 0) return null;
  const top = summarizePmccLegRejections(longs)[0];
  if (!top) return null;
  return `Long leg blocked: ${top.message} (${longs.length} contract${longs.length === 1 ? '' : 's'}).`;
}

/** " · bid $0.85" for an excluded contract that carried a usable bid, else ''. */
export function excludedContractPremiumText(rejection: Pick<PmccLegRejection, 'bid'>): string {
  const bid = rejection.bid;
  return typeof bid === 'number' && Number.isFinite(bid) && bid > 0 ? ` · bid $${bid.toFixed(2)}` : '';
}
