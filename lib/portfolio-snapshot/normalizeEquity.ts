// lib/portfolio-snapshot/normalizeEquity.ts
//
// LCC-0001A — equity-holding normalization. Implements
// docs/design/LCC-0001A-technical-spec.md §5.
//
// Ports lib/scans/covered-call-capacity.ts's normalizeEquityHoldings() (lines 89-135 at the time
// this ticket was specified) with exactly two behavior changes, both required by LCC-0001A's
// acceptance criteria and neither present in that module (which was written for capacity-only,
// not visibility):
//
//   1. Retain short equity rows instead of filtering them out. The source function's
//      `if (p['quantity-direction'] !== 'Long') continue;` silently drops short rows entirely.
//      Here, short rows are aggregated into their own direction: 'Short' EquityHolding, with
//      quantity tracked as a positive magnitude and direction carrying the sign.
//   2. Retain zero/short-adjacent edge cases visibly where the source function would `continue`
//      (e.g. non-positive quantity) -- these remain dropped; a zero/negative quantity is not a
//      real holding to display. Only the direction filter changes.
//
// The weighted-basis and costBasisComplete logic is ported verbatim, unchanged, per group -- this
// satisfies LCC-0001A's "Incomplete basis" acceptance criterion exactly as the existing module
// already guarantees it: a partial-lot average is never presented as the whole-holding basis.
//
// This module is pure normalization only. It consumes broker mark/close evidence already present
// on the canonical marked-position response; it never fetches quotes or fabricates missing values.

import type { EquityDirection, EquityHolding } from './types';

// Narrow, structural input shape -- deliberately mirrors only the raw broker fields this module
// reads, matching lib/scans/covered-call-capacity.ts's RawPositionLike convention so raw broker
// field names never leak past this normalization boundary into callers.
export interface RawPositionLike {
  'instrument-type'?: string;
  'underlying-symbol'?: string;
  symbol?: string;
  quantity?: string | number;
  'quantity-direction'?: string;
  'average-open-price'?: string | number;
  'mark-price'?: string | number;
  'close-price'?: string | number;
}

interface GroupAccumulator {
  shares: number;
  costWeightedSum: number;
  costKnownShares: number;
  anyLotMissingBasis: boolean;
  quoteWeightedSum: number;
  quoteKnownShares: number;
  anyQuoteFromClose: boolean;
}

function groupKey(symbol: string, direction: EquityDirection): string {
  return `${symbol}::${direction}`;
}

/**
 * Normalizes raw broker equity positions into account-scoped EquityHolding values.
 *
 * Groups by symbol + direction (not symbol alone) so long and short positions in the same
 * underlying are never merged -- each group's weighted-basis/costBasisComplete computation is
 * therefore always over positions of a single, unambiguous direction.
 */
export function normalizeEquityHoldings(
  rawPositions: RawPositionLike[],
  accountNumber: string,
): EquityHolding[] {
  const groups: Record<string, GroupAccumulator> = {};
  const directionBySymbol: Record<string, EquityDirection> = {};
  const symbolByKey: Record<string, string> = {};

  for (const p of rawPositions) {
    if (p['instrument-type'] !== 'Equity') continue;

    const rawDirection = p['quantity-direction'];
    // Retained (not dropped) unlike the source module: both Long and Short are aggregated, each
    // into its own group. Any other/unknown direction value is not a real holding to display and
    // is dropped, matching the source module's implicit behavior for anything that isn't 'Long'.
    const direction: EquityDirection | null =
      rawDirection === 'Long' ? 'Long' : rawDirection === 'Short' ? 'Short' : null;
    if (direction === null) continue;

    const symbol = p['underlying-symbol'] ?? p.symbol;
    if (!symbol) continue;

    const qty = Number(p.quantity ?? 0);
    if (!(qty > 0)) continue; // invalid/zero/negative quantities are not a real holding

    const key = groupKey(symbol, direction);
    if (!groups[key]) {
      groups[key] = { shares: 0, costWeightedSum: 0, costKnownShares: 0, anyLotMissingBasis: false, quoteWeightedSum: 0, quoteKnownShares: 0, anyQuoteFromClose: false };
      directionBySymbol[key] = direction;
      symbolByKey[key] = symbol;
    }
    groups[key].shares += qty;
    const mark = Number(p['mark-price']);
    const close = Number(p['close-price']);
    const hasMark = Number.isFinite(mark) && mark > 0;
    const hasClose = Number.isFinite(close) && close > 0;
    const quote = hasMark ? mark : hasClose ? close : NaN;
    if (Number.isFinite(quote) && quote > 0) {
      groups[key].quoteWeightedSum += quote * qty;
      groups[key].quoteKnownShares += qty;
      if (!hasMark) groups[key].anyQuoteFromClose = true;
    }

    const rawCost = p['average-open-price'];
    const cost = rawCost != null ? Number(rawCost) : NaN;
    if (!isNaN(cost) && cost > 0) {
      groups[key].costWeightedSum += cost * qty;
      groups[key].costKnownShares += qty;
    } else {
      // This lot contributes shares but has no usable basis -- the aggregate basis for this
      // symbol+direction group can no longer be treated as complete, even though other lots in
      // the same group do have valid basis values. Ported verbatim from the source module's
      // TE-0007C corrective-round rationale.
      groups[key].anyLotMissingBasis = true;
    }
  }

  const result: EquityHolding[] = [];
  for (const [key, agg] of Object.entries(groups)) {
    // Ported verbatim: a partial basis (e.g. 100sh known + 100sh unknown) is never returned as if
    // it applied to the whole holding -- costBasis is null unless every contributing lot's basis
    // was known.
    const complete = agg.shares > 0 && !agg.anyLotMissingBasis && agg.costKnownShares === agg.shares;
    const quoteComplete = agg.quoteKnownShares === agg.shares;
    const currentPrice = quoteComplete ? agg.quoteWeightedSum / agg.quoteKnownShares : null;
    const basis = complete ? agg.costWeightedSum / agg.costKnownShares : null;
    result.push({
      accountNumber,
      symbol: symbolByKey[key],
      direction: directionBySymbol[key],
      quantity: agg.shares,
      settledQuantity: null,
      basis,
      basisComplete: complete,
      currentPrice,
      marketValue: currentPrice == null ? null : currentPrice * agg.shares * (directionBySymbol[key] === 'Short' ? -1 : 1),
      unrealizedPnl: currentPrice == null || basis == null ? null : (currentPrice - basis) * agg.shares * (directionBySymbol[key] === 'Short' ? -1 : 1),
      // The marked-position payload does not carry a verified broker quote timestamp. Snapshot
      // acquisition time belongs in PortfolioSnapshot.asOf and must not be fabricated as quote
      // provenance. Mark and prior-close economics therefore have unknown freshness.
      quoteAsOf: null,
      staleQuote: true,
      deliverable: 'standard',
      dataQualityWarnings: agg.anyQuoteFromClose
        ? ['Current mark unavailable; using prior close as stale reference pricing.']
        : [],
    });
  }
  return result;
}
