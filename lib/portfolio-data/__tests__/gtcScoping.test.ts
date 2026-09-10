import { describe, expect, it } from 'vitest';
import { findProfitGtcOrder } from '../acquisition';
import type { GtcOrder, PositionLeg } from '../types';

// GTC-SCOPE-0001 regression: the bug report's MRNA row showed "GTC Live"
// (green) directly above "Stop Unsupported" for a standalone long put with
// no working order of its own. Root cause: `hasGtc` was computed from a
// Set keyed by UNDERLYING TICKER ONLY (gtcSymbols.has('MRNA')), built from
// every live GTC order anywhere in the account -- so a profit-target order
// on a completely different MRNA position lit up "GTC Live" on this one
// too. `hasGtc`/`gtcOrderId`/`gtcComplexOrderId`/`gtcOrderPrice` are now
// all derived from ONE call to findProfitGtcOrder, which was already
// correctly leg-scoped -- this file is that function's first direct unit
// coverage (it previously had none, even though it backed real UI state).
function leg(overrides: Partial<PositionLeg> = {}): PositionLeg {
  return {
    symbol: 'MRNA  261120P00140000',
    optionType: 'P',
    strikePrice: 140,
    direction: 'Long',
    quantity: 1,
    avgOpenPrice: 2.5,
    currentPrice: 2.0,
    ...overrides,
  };
}

function gtcOrder(overrides: Partial<GtcOrder> = {}): GtcOrder {
  return {
    id: 'order-1',
    price: '1.50',
    stopPrice: null,
    orderType: 'Limit',
    timeInForce: 'GTC',
    legs: [],
    ...overrides,
  };
}

describe('findProfitGtcOrder: position-scoped, not account/symbol-wide', () => {
  it('returns null for a standalone long put with no short leg at all (the exact MRNA case)', () => {
    // A standalone long put has no short leg -- findProfitGtcOrder requires
    // one (it's defined as "Buy to Close on the short leg"), so it must
    // return null regardless of what other orders exist in the account.
    const positionLegs = [leg()];
    const unrelatedOrderOnSameTicker = gtcOrder({
      legs: [{ symbol: 'MRNA  261204P00135000', action: 'Buy to Close', quantity: 1 }],
    });
    expect(findProfitGtcOrder(positionLegs, [unrelatedOrderOnSameTicker])).toBeNull();
  });

  it('does not match an order belonging to a DIFFERENT position on the same underlying', () => {
    // This is the actual bug: two short puts on the same ticker, different
    // strikes. A profit-target order on the 135-strike position must not
    // make the 140-strike position report hasGtc/gtcOrderId truthy.
    const thisPositionLegs = [leg({ symbol: 'MRNA  261120P00140000', direction: 'Short' })];
    const otherPositionsOrder = gtcOrder({
      legs: [{ symbol: 'MRNA  261204P00135000', action: 'Buy to Close', quantity: 1 }],
    });
    expect(findProfitGtcOrder(thisPositionLegs, [otherPositionsOrder])).toBeNull();
  });

  it('matches when the live order is genuinely for this position\'s own short leg', () => {
    const thisPositionLegs = [leg({ symbol: 'MRNA  261120P00140000', direction: 'Short' })];
    const ownOrder = gtcOrder({
      id: 'own-order',
      legs: [{ symbol: 'MRNA  261120P00140000', action: 'Buy to Close', quantity: 1 }],
    });
    const result = findProfitGtcOrder(thisPositionLegs, [ownOrder]);
    expect(result?.id).toBe('own-order');
  });

  it('never matches a stop order, even on the position\'s own leg', () => {
    const thisPositionLegs = [leg({ symbol: 'MRNA  261120P00140000', direction: 'Short' })];
    const ownStopOrder = gtcOrder({
      id: 'own-stop',
      orderType: 'Stop',
      stopPrice: '3.00',
      legs: [{ symbol: 'MRNA  261120P00140000', action: 'Buy to Close', quantity: 1 }],
    });
    expect(findProfitGtcOrder(thisPositionLegs, [ownStopOrder])).toBeNull();
  });
});
