// features/portfolio/positions-workspace/__tests__/stockHoldingsSellable.test.ts
//
// STOCKS-ORDERS-0001 -- StockHoldingRow.sellable, built via the toCoveredCallCapacity
// adapter reusing lib/portfolio/stockOrderSafety.ts's computeMaxSellableShares (the
// STOCKS-ORDERS-CLEANUP-0001 fix: no fourth duplicate "shares free to sell" computation).

import { describe, expect, it } from 'vitest';
import type { EquityHolding } from '@/lib/portfolio-snapshot/types';
import { buildStockHoldingRows } from '../model/stockHoldings';
import type { CapacityViewModel } from '../model/types';

const holding = (over: Partial<EquityHolding>): EquityHolding => ({
  accountNumber: 'ACCT-1', symbol: 'META', direction: 'Long', quantity: 5, settledQuantity: null, basis: 549, basisComplete: true, currentPrice: 668.4, marketValue: 3342, unrealizedPnl: 596,
  quoteAsOf: '2026-09-21T02:45:19.000Z', staleQuote: false, deliverable: 'standard', dataQualityWarnings: [], ...over,
});
const capacity = (over: Partial<CapacityViewModel> = {}): CapacityViewModel => ({ status: 'ok', sharesOwned: 5, allocatedContracts: 0, reservedContracts: 0, availableContracts: 0, remainderShares: 5, basisComplete: true, blockingReason: null, unallocatedShares: 5, ...over });
const row = (h: EquityHolding, cap: Partial<CapacityViewModel> = {}) =>
  buildStockHoldingRows([{ symbol: h.symbol, equities: [h], capacity: capacity({ sharesOwned: h.direction === 'Long' ? h.quantity : 0, unallocatedShares: h.direction === 'Long' ? h.quantity : 0, ...cap }) }])[0];

describe('StockHoldingRow.sellable', () => {
  it('an uncommitted holding: all shares are sellable', () => {
    expect(row(holding({ quantity: 200 }), { sharesOwned: 200, unallocatedShares: 200 }).sellable).toMatchObject({ maxSellableShares: 200, sharesCommitted: 0, blockedByDataQuality: false });
  });

  it('a fully committed holding: 0 sellable, not negative', () => {
    expect(row(holding({ quantity: 200 }), { sharesOwned: 200, allocatedContracts: 2, unallocatedShares: 0 }).sellable).toMatchObject({ maxSellableShares: 0, sharesCommitted: 200 });
  });

  it('a partially committed holding: only the uncommitted shares', () => {
    expect(row(holding({ quantity: 300 }), { sharesOwned: 300, allocatedContracts: 1, reservedContracts: 1, unallocatedShares: 100 }).sellable)
      .toMatchObject({ maxSellableShares: 100, sharesCommitted: 200 });
  });

  it('a short holding is never sellable via this path (Buy to Cover is out of v1)', () => {
    expect(row(holding({ direction: 'Short', quantity: 100 })).sellable).toMatchObject({ maxSellableShares: 0, blockedByDataQuality: false });
  });

  it('unavailable capacity data fails closed, with the reason surfaced', () => {
    const r = row(holding({ quantity: 200 }), { status: 'unavailable', blockingReason: 'stale broker data' });
    expect(r.sellable).toMatchObject({ maxSellableShares: 0, blockedByDataQuality: true });
    expect(r.sellable.reason).toBe('stale broker data');
  });

  it('matches CapacityViewModel.unallocatedShares exactly -- the adapter does not silently diverge from the existing field', () => {
    const r = row(holding({ quantity: 450 }), { sharesOwned: 450, allocatedContracts: 3, unallocatedShares: 150 });
    expect(r.sellable.maxSellableShares).toBe(150);
  });
});
