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

export interface HeldIncomeSummary {
  /** "$60 per contract": the short bid x 100. */
  collect: string;
  /** "16.0% above price" (or "below price"), or null when the stock price is unusable. */
  abovePrice: string | null;
  /** "about 18% chance of assignment" from the short delta, or null. */
  chanceAssigned: string | null;
  /** "If assigned and LEAP exercised: -$17.75/sh (-$1,775 per contract), before fees." Null without a usable cost basis. */
  assignedOutcome: string | null;
}

const usd = (value: number, digits: number): string => `${value < 0 ? '-' : ''}$${Math.abs(value).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;

/**
 * PMCC-HELD-UNDERWATER-0001B (Ian): plain-English income line for a held-LEAP short call. Words only; no
 * qualification decision lives here. `widthMinusCostPerShare` is the cost-based held figure (null when the
 * cost basis was unusable), always labeled as the result "if assigned and LEAP exercised", never an expected P/L.
 */
export function heldIncomeSummary(input: {
  shortBid: number; shortStrike: number; shortDelta: number | null | undefined; spot: number | null | undefined;
  widthMinusCostPerShare: number | null | undefined;
}): HeldIncomeSummary {
  const collect = `${usd(Math.round(input.shortBid * 100), 0)} per contract`;
  const spot = input.spot;
  const abovePrice = typeof spot === 'number' && Number.isFinite(spot) && spot > 0
    ? `${Math.abs((input.shortStrike / spot - 1) * 100).toFixed(1)}% ${input.shortStrike >= spot ? 'above' : 'below'} price`
    : null;
  const delta = input.shortDelta;
  const chanceAssigned = typeof delta === 'number' && Number.isFinite(delta) ? `about ${Math.round(Math.abs(delta) * 100)}% chance of assignment` : null;
  const w = input.widthMinusCostPerShare;
  const assignedOutcome = typeof w === 'number' && Number.isFinite(w)
    ? `If assigned and LEAP exercised: ${usd(w, 2)}/sh (${usd(Math.round(w * 100), 0)} per contract), before fees. Not an expected P/L.`
    : null;
  return { collect, abovePrice, chanceAssigned, assignedOutcome };
}
