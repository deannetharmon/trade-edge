// lib/portfolio/stockOrderSafety.ts
//
// STOCKS-ORDERS-0001 — the hard safety gate: shares that back a covered call
// must never be sold, because a sale would leave that call uncovered. This
// computes the ONE number both the UI (row-disable + dialog quantity cap) and
// the submit-time re-check depend on, so they can never drift into two
// different answers about how many shares are actually free to sell.
//
// Fails closed: any exposure the capacity model could not fully classify, or
// an unavailable capacity report (stale/incomplete data), yields 0 sellable
// shares -- never a guess. See lib/portfolio-snapshot/capacity.ts for the
// upstream CoveredCallCapacity / SnapshotCapacityReport this consumes.

import type { CoveredCallCapacity, SnapshotCapacityReport } from '@/lib/portfolio-snapshot/capacity';

export interface SellableSharesResult {
  /** Shares free to sell right now without leaving a covered call uncovered. Never negative. */
  maxSellableShares: number;
  sharesOwned: number;
  /** Shares committed to existing short calls or pending (working) sell-to-open orders. */
  sharesCommitted: number;
  /** True when maxSellableShares is 0 because the data itself could not be trusted (not because 0 shares are genuinely free). */
  blockedByDataQuality: boolean;
  reason: string | null;
}

const BLOCKED = (sharesOwned: number, reason: string): SellableSharesResult => ({
  maxSellableShares: 0, sharesOwned, sharesCommitted: 0, blockedByDataQuality: true, reason,
});

/**
 * The per-symbol calculation. `capacity` is the same CoveredCallCapacity the
 * covered-call scanner already computes for this symbol -- never re-derived
 * from a separate, parallel source.
 */
export function computeMaxSellableShares(capacity: CoveredCallCapacity): SellableSharesResult {
  if (capacity.hasUnclassifiedExposure) {
    // Some existing or working short-option position for this symbol could not
    // be confirmed as call/put. Treat it as a call until proven otherwise --
    // never assume shares are free just because classification failed.
    return BLOCKED(capacity.sharesOwned, 'Some option exposure on this symbol could not be verified as a call or put; selling is blocked until it can be classified.');
  }
  const sharesCommitted = 100 * (capacity.existingShortCallContracts + capacity.workingShortCallContracts);
  const maxSellableShares = Math.max(0, capacity.sharesOwned - sharesCommitted);
  return {
    maxSellableShares, sharesOwned: capacity.sharesOwned, sharesCommitted,
    blockedByDataQuality: false,
    reason: capacity.oversubscribed ? 'More calls are committed against this symbol than its shares can cover; nothing is available to sell until that is resolved.' : null,
  };
}

/**
 * The full boundary a stock-sell UI or submit path should call: takes the
 * whole snapshot capacity report (which already carries the account-wide
 * data-quality gate) plus the symbol, and fails closed on any unavailable
 * report or missing symbol -- a symbol absent from the report means the
 * account holds no Long position in it, so nothing is sellable.
 */
export function resolveMaxSellableShares(report: SnapshotCapacityReport, symbol: string): SellableSharesResult {
  if (report.status === 'unavailable') {
    return BLOCKED(0, report.unavailableReason ?? 'Position and order data could not be verified for this account; selling is blocked until it can be.');
  }
  const capacity = report.bySymbol[symbol];
  if (!capacity) {
    return BLOCKED(0, `No verified long holding of ${symbol} was found in this account.`);
  }
  return computeMaxSellableShares(capacity);
}
