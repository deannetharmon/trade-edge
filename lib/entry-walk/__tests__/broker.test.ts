// lib/entry-walk/__tests__/broker.test.ts

import { describe, expect, it } from 'vitest';
import { netQuoteFromLegs, parseComplexOrderStatus } from '../broker';

const order = (status: string, legs: any[]) => ({ data: { 'trigger-order': { status, legs }, orders: [{ status: 'Contingent', legs: [] }] } });
const leg = (quantity: number, fills: number[] = [], remaining?: number) => ({
  quantity, fills: fills.map(q => ({ quantity: q })), ...(remaining != null ? { 'remaining-quantity': remaining } : {}),
});

describe('parseComplexOrderStatus', () => {
  it('live statuses', () => {
    for (const s of ['Received', 'Routed', 'In Flight', 'Live', 'Contingent', 'Cancel Requested']) {
      expect(parseComplexOrderStatus(order(s, [leg(1), leg(1)])).state).toBe('live');
    }
  });
  it('filled', () => expect(parseComplexOrderStatus(order('Filled', [leg(3, [3]), leg(3, [3])]))).toMatchObject({ state: 'filled', totalQty: 3 }));
  it('closed statuses', () => {
    for (const s of ['Cancelled', 'Expired', 'Rejected', 'Removed']) expect(parseComplexOrderStatus(order(s, [leg(1)])).state).toBe('closed');
  });
  it('partial fill: counts the smallest per-leg fill', () => {
    expect(parseComplexOrderStatus(order('Live', [leg(3, [2]), leg(3, [2, 0])]))).toEqual({ state: 'partial', filledQty: 2, totalQty: 3 });
    expect(parseComplexOrderStatus(order('Live', [leg(3, [], 1), leg(3, [], 1)]))).toMatchObject({ state: 'partial', filledQty: 2 });
  });
  it('a cancelled order that part-filled is a partial fill, not a clean cancel', () => {
    expect(parseComplexOrderStatus(order('Cancelled', [leg(3, [1]), leg(3, [1])])).state).toBe('partial');
  });
  it('the contingent exits are never read as the entry', () => {
    const json = { data: { 'trigger-order': { status: 'Live', legs: [leg(1)] }, orders: [{ status: 'Filled', legs: [leg(1, [1])] }] } };
    expect(parseComplexOrderStatus(json).state).toBe('live');
  });
  it('anything unrecognised is unknown', () => {
    expect(parseComplexOrderStatus(null).state).toBe('unknown');
    expect(parseComplexOrderStatus({ data: {} }).state).toBe('unknown');
    expect(parseComplexOrderStatus(order('Strange', [leg(1)])).state).toBe('unknown');
  });
});

describe('netQuoteFromLegs', () => {
  const legs = [{ symbol: 'S', action: 'Sell to Open' }, { symbol: 'L', action: 'Buy to Open' }];
  it('sold legs at bid/ask, bought legs at ask/bid', () => {
    const q = netQuoteFromLegs(legs, [
      { symbol: 'S', bid: 2.0, ask: 2.1, ageSeconds: 1 },
      { symbol: 'L', bid: 0.75, ask: 0.8, ageSeconds: 3 },
    ]);
    expect(q).toEqual({ netBid: 1.2, netAsk: 1.35, legSpreads: [0.1, 0.05], ageSeconds: 3 });
  });
  it('null when a leg has no quote, a crossed quote, or no bid', () => {
    expect(netQuoteFromLegs(legs, [{ symbol: 'S', bid: 2, ask: 2.1, ageSeconds: 1 }])).toBeNull();
    expect(netQuoteFromLegs(legs, [{ symbol: 'S', bid: 2.2, ask: 2.1, ageSeconds: 1 }, { symbol: 'L', bid: 1, ask: 1.1, ageSeconds: 1 }])).toBeNull();
    expect(netQuoteFromLegs(legs, [{ symbol: 'S', bid: 0, ask: 2.1, ageSeconds: 1 }, { symbol: 'L', bid: 1, ask: 1.1, ageSeconds: 1 }])).toBeNull();
  });
  it('an unknown age stays unknown', () => {
    const q = netQuoteFromLegs(legs, [{ symbol: 'S', bid: 2, ask: 2.1, ageSeconds: null }, { symbol: 'L', bid: 0.8, ask: 0.9, ageSeconds: 2 }]);
    expect(q?.ageSeconds).toBeNull();
  });
});
