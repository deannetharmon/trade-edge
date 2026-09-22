// lib/portfolio/__tests__/stockOrders.test.ts
//
// STOCKS-ORDERS-0001: the hard safety gate (shares backing a covered call
// must never be sellable), the equity order builder, and the submit boundary
// that structurally cannot reach a broker call without the gate passing.

import { describe, it, expect, vi } from 'vitest';
import { computeCoveredCallCapacity } from '@/lib/portfolio-snapshot/capacity';
import type { CoveredCallCapacity, SnapshotCapacityReport } from '@/lib/portfolio-snapshot/capacity';
import { computeMaxSellableShares, resolveMaxSellableShares } from '../stockOrderSafety';
import { buildStockSellOrder, DEFAULT_STOCK_ORDER_TIF } from '../stockOrderBuilder';
import { guardStockSellOrder, submitStockSellOrderIfSafe } from '../stockOrderSubmission';

const report = (bySymbol: Record<string, CoveredCallCapacity>, status: SnapshotCapacityReport['status'] = 'ok'): SnapshotCapacityReport => ({
  status, bySymbol, warnings: [], unavailableReason: status === 'unavailable' ? 'stale data' : undefined,
});

describe('computeMaxSellableShares — the ticket\'s required cases', () => {
  it('an uncommitted holding: all shares are sellable', () => {
    const c = computeCoveredCallCapacity(200, 0, 0);
    expect(computeMaxSellableShares(c)).toMatchObject({ maxSellableShares: 200, sharesCommitted: 0, blockedByDataQuality: false });
  });

  it('a fully committed holding: 0 shares sellable, not a negative number', () => {
    // 200 shares, 2 existing short calls -> 200 committed -> 0 sellable.
    const c = computeCoveredCallCapacity(200, 2, 0);
    expect(computeMaxSellableShares(c)).toMatchObject({ maxSellableShares: 0, sharesCommitted: 200 });
  });

  it('a partially committed holding: only the uncommitted shares are sellable', () => {
    // 300 shares, 1 existing + 1 working short call -> 200 committed -> 100 sellable.
    const c = computeCoveredCallCapacity(300, 1, 1);
    expect(computeMaxSellableShares(c)).toMatchObject({ maxSellableShares: 100, sharesCommitted: 200, sharesOwned: 300 });
  });

  it('a short-stock symbol never appears as sellable via this path (Buy to Cover is out of v1)', () => {
    // capacity.ts filters Short holdings to sharesOwned: 0 with zero contracts before this
    // function ever sees them -- confirms the safety gate cannot make a short position sellable.
    const c = computeCoveredCallCapacity(0, 0, 0);
    expect(computeMaxSellableShares(c)).toMatchObject({ maxSellableShares: 0, sharesOwned: 0 });
  });

  it('unclassified exposure fails closed to 0, even with plenty of shares and no confirmed commitment', () => {
    const c = computeCoveredCallCapacity(500, 0, 0, null, false, true);
    const result = computeMaxSellableShares(c);
    expect(result).toMatchObject({ maxSellableShares: 0, blockedByDataQuality: true });
    expect(result.reason).toMatch(/could not be verified/i);
  });

  it('oversubscribed (more committed than owned -- should not happen, but never negative) reports 0 with a reason, not a negative number', () => {
    const c = computeCoveredCallCapacity(100, 2, 0); // 200 committed against 100 owned
    expect(c.oversubscribed).toBe(true);
    const result = computeMaxSellableShares(c);
    expect(result.maxSellableShares).toBe(0);
    expect(result.reason).toMatch(/more calls are committed/i);
  });
});

describe('resolveMaxSellableShares — the account-level boundary', () => {
  it('an unavailable capacity report blocks selling, with the report\'s own reason surfaced', () => {
    const result = resolveMaxSellableShares(report({}, 'unavailable'), 'AAPL');
    expect(result).toMatchObject({ maxSellableShares: 0, blockedByDataQuality: true, reason: 'stale data' });
  });

  it('a symbol with no verified Long holding blocks selling', () => {
    const result = resolveMaxSellableShares(report({}), 'AAPL');
    expect(result.maxSellableShares).toBe(0);
    expect(result.reason).toMatch(/no verified long holding/i);
  });

  it('routes through to the per-symbol calculation for a real holding', () => {
    const result = resolveMaxSellableShares(report({ AAPL: computeCoveredCallCapacity(200, 1, 0) }), 'AAPL');
    expect(result).toMatchObject({ maxSellableShares: 100, sharesCommitted: 100 });
  });
});

describe('buildStockSellOrder', () => {
  it('builds a Sell to Close order matching the existing order-body convention (time-in-force / order-type / price / legs)', () => {
    const built = buildStockSellOrder({ symbol: 'AAPL', quantity: 50, limitPrice: 190.5 });
    expect(built).toEqual({
      ok: true,
      order: {
        'time-in-force': 'GTC',
        'order-type': 'Limit',
        price: '190.50',
        legs: [{ symbol: 'AAPL', quantity: 50, action: 'Sell to Close', 'order-leg-type': 'Equity' }],
      },
    });
  });

  it('defaults time in force to GTC (decided 2026-09-21) and allows an explicit override', () => {
    expect(DEFAULT_STOCK_ORDER_TIF).toBe('GTC');
    expect(buildStockSellOrder({ symbol: 'AAPL', quantity: 1, limitPrice: 100 })).toMatchObject({ order: { 'time-in-force': 'GTC' } });
    expect(buildStockSellOrder({ symbol: 'AAPL', quantity: 1, limitPrice: 100, timeInForce: 'Day' })).toMatchObject({ order: { 'time-in-force': 'Day' } });
  });

  it('never emits a "Buy to Cover" action -- out of v1, and not a value this builder can produce at all', () => {
    const built = buildStockSellOrder({ symbol: 'AAPL', quantity: 1, limitPrice: 100 });
    expect(built.ok && built.order.legs[0].action).toBe('Sell to Close');
  });

  it.each([
    ['a zero quantity', { symbol: 'AAPL', quantity: 0, limitPrice: 100 }],
    ['a negative quantity', { symbol: 'AAPL', quantity: -5, limitPrice: 100 }],
    ['a fractional quantity', { symbol: 'AAPL', quantity: 1.5, limitPrice: 100 }],
    ['a zero limit price', { symbol: 'AAPL', quantity: 1, limitPrice: 0 }],
    ['a negative limit price', { symbol: 'AAPL', quantity: 1, limitPrice: -1 }],
    ['a missing symbol', { symbol: '', quantity: 1, limitPrice: 100 }],
  ])('rejects %s', (_name, input) => {
    expect(buildStockSellOrder(input).ok).toBe(false);
  });
});

describe('guardStockSellOrder / submitStockSellOrderIfSafe — the submit-time boundary', () => {
  const partiallyCommitted = report({ AAPL: computeCoveredCallCapacity(300, 1, 0) }); // 100 committed, 200 sellable

  it('allows a quantity within the sellable limit and builds the order', () => {
    const guard = guardStockSellOrder(partiallyCommitted, { symbol: 'AAPL', quantity: 200, limitPrice: 190 });
    expect(guard.allowed).toBe(true);
    expect(guard.allowed && guard.order.legs[0].quantity).toBe(200);
  });

  it('blocks a quantity that exceeds the sellable limit, with the commitment explained', () => {
    const guard = guardStockSellOrder(partiallyCommitted, { symbol: 'AAPL', quantity: 201, limitPrice: 190 });
    expect(guard.allowed).toBe(false);
    expect(!guard.allowed && guard.reason).toMatch(/200 of 300 AAPL shares/);
    expect(!guard.allowed && guard.reason).toMatch(/100 are committed/);
  });

  it('blocks entirely when 0 shares are sellable (fully committed) -- matches Ian\'s row-disable case', () => {
    const fullyCommitted = report({ AAPL: computeCoveredCallCapacity(200, 2, 0) });
    const guard = guardStockSellOrder(fullyCommitted, { symbol: 'AAPL', quantity: 1, limitPrice: 190 });
    expect(guard.allowed).toBe(false);
  });

  it('THE broker call is structurally unreachable when the guard fails -- submitToBroker is never invoked', async () => {
    const submitToBroker = vi.fn();
    const result = await submitStockSellOrderIfSafe(partiallyCommitted, { symbol: 'AAPL', quantity: 999, limitPrice: 190 }, submitToBroker);
    expect(result.submitted).toBe(false);
    expect(submitToBroker).not.toHaveBeenCalled();
  });

  it('submits only the guarded order, and returns the broker result', async () => {
    const submitToBroker = vi.fn().mockResolvedValue({ id: 'order-1' });
    const result = await submitStockSellOrderIfSafe(partiallyCommitted, { symbol: 'AAPL', quantity: 150, limitPrice: 190 }, submitToBroker);
    expect(result).toMatchObject({ submitted: true, result: { id: 'order-1' } });
    expect(submitToBroker).toHaveBeenCalledWith(expect.objectContaining({ legs: [expect.objectContaining({ quantity: 150 })] }));
  });

  it('re-resolves from the report passed at call time, not a cached earlier result -- proves the "never trusted from the screen" requirement', async () => {
    const staleGoodReport = report({ AAPL: computeCoveredCallCapacity(300, 0, 0) }); // looked fine a moment ago
    const freshBadReport = report({ AAPL: computeCoveredCallCapacity(300, 3, 0) }); // now fully committed
    const submitToBroker = vi.fn();
    // Caller passes the FRESH report at submit time, even though a stale one existed earlier.
    const result = await submitStockSellOrderIfSafe(freshBadReport, { symbol: 'AAPL', quantity: 300, limitPrice: 190 }, submitToBroker);
    expect(result.submitted).toBe(false);
    expect(submitToBroker).not.toHaveBeenCalled();
    void staleGoodReport;
  });
});
