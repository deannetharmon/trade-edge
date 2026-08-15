// lib/portfolio/pmccLegEconomics.ts
//
// PMCC short-leg profit-target/stop-loss ticket. The existing GTC/stop
// recommendation engine (app/portfolio/page.tsx's buildStopGtcPrompt) is
// built entirely around a Position's NET entry economics being a credit
// (hasSupportedCreditEntryEconomics/canonicalEntryCredit in
// positionMetrics.ts) -- a PMCC position's net entry economics are a
// DEBIT (you pay to open the diagonal), so that whole-position path
// correctly fails closed (throws) for a real PMCC rather than producing a
// wrong suggestion.
//
// This module is deliberately additive and isolated, not a modification
// to positionMetrics.ts: it computes entry credit for ONE short leg in
// isolation, independent of the position's net (debit) economics, so a
// PMCC-specific prompt path can manage just the short call the way any
// covered call's short leg is managed -- per Ian's explicit guidance, the
// long LEAPS leg never receives a mechanical target or stop at all, so
// this module has no long-leg equivalent by design, not by omission.

import { CONTRACT_MULTIPLIER } from './positionMetrics';

// Deliberately its own shape, not EntryEconomicsLike -- that interface's
// fields (entryCredit, entryPriceEffect, creditReceived) are whole-
// position aggregates; a leg only ever has its own fill price/quantity,
// plus (per Ian's requirement) its OWN dte/strike so a PMCC prompt never
// mixes the short leg's price with the position's or long leg's timeline.
export interface PmccShortLegLike {
  direction: 'Short' | 'Long';
  quantity: number;
  avgOpenPrice: number | null;
  dte: number | null;
  strikePrice: number | null;
}

/**
 * Entry credit for a single short leg, computed from that leg's own fill
 * price alone -- never from the position's net (debit) economics. Fails
 * closed (returns null) on a non-short leg or missing/invalid fill data,
 * same convention as canonicalEntryCredit's fail-closed behavior for the
 * whole-position case.
 */
export function canonicalShortLegEntryCredit(leg: PmccShortLegLike): number | null {
  if (leg.direction !== 'Short') return null;
  if (leg.avgOpenPrice == null || !Number.isFinite(leg.avgOpenPrice) || leg.avgOpenPrice < 0) return null;
  const qty = Math.abs(leg.quantity);
  if (!Number.isFinite(qty) || qty <= 0) return null;
  return leg.avgOpenPrice * qty * CONTRACT_MULTIPLIER;
}

/** True only when the short leg has a usable, positive entry credit. */
export function hasSupportedShortLegEntryEconomics(leg: PmccShortLegLike): boolean {
  const credit = canonicalShortLegEntryCredit(leg);
  return credit != null && credit > 0;
}

/**
 * Per-contract credit for the short leg -- the number the GTC/stop prompt
 * actually reasons about (dollars per contract, not the total). Null
 * whenever the underlying credit or quantity is unusable.
 */
export function canonicalShortLegCreditPerContract(leg: PmccShortLegLike): number | null {
  const totalCredit = canonicalShortLegEntryCredit(leg);
  const qty = Math.abs(leg.quantity);
  if (totalCredit == null || !Number.isFinite(qty) || qty <= 0) return null;
  return totalCredit / (qty * CONTRACT_MULTIPLIER);
}

