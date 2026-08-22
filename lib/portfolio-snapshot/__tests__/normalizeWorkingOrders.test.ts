// lib/portfolio-snapshot/__tests__/normalizeWorkingOrders.test.ts
// LCC-0001A PR 2 — working-order reservation and shape normalization tests.
import { describe, it, expect } from 'vitest';
import {
  normalizeWorkingCallReservations,
  normalizeWorkingOrders,
  type RawOrderLike,
} from '../normalizeWorkingOrders';

const sellToOpenCallOrder = (symbol: string, qty: number, status = 'Live'): RawOrderLike => ({
  id: `ord-${symbol}`,
  status,
  legs: [
    {
      'underlying-symbol': symbol,
      symbol: `${symbol}250101C00100000`,
      action: 'Sell to Open',
      'instrument-type': 'Equity Option',
      'option-type': 'C',
      quantity: qty,
    },
  ],
});

describe('normalizeWorkingCallReservations', () => {
  it('flags an adjusted working-order deliverable so capacity fails closed', () => {
    const result = normalizeWorkingCallReservations([{ status: 'Working', legs: [{ action: 'Sell to Open', 'instrument-type': 'Equity Option', 'underlying-symbol': 'AAPL', 'option-type': 'C', quantity: 1, multiplier: 150 }] }]);
    expect(result.hasAdjustedOrUnknownDeliverable).toBe(true);
  });
  it('reserves capacity for a live sell-to-open call order', () => {
    const result = normalizeWorkingCallReservations([sellToOpenCallOrder('AAPL', 1)]);
    expect(result.bySymbol.AAPL).toBe(1);
  });

  it('ignores filled/cancelled/rejected/expired orders', () => {
    for (const status of ['Filled', 'Cancelled', 'Rejected', 'Expired']) {
      const result = normalizeWorkingCallReservations([sellToOpenCallOrder('AAPL', 1, status)]);
      expect(result.bySymbol.AAPL).toBeUndefined();
    }
  });

  it('matches status/action case- and whitespace-insensitively', () => {
    const order: RawOrderLike = {
      status: '  LIVE  ',
      legs: [
        {
          'underlying-symbol': 'AAPL',
          symbol: 'AAPL250101C00100000',
          action: '  SELL TO OPEN  ',
          'instrument-type': 'Equity Option',
          'option-type': 'C',
          quantity: 1,
        },
      ],
    };
    const result = normalizeWorkingCallReservations([order]);
    expect(result.bySymbol.AAPL).toBe(1);
  });

  it('never reserves capacity for a buy-to-close leg', () => {
    const order: RawOrderLike = {
      status: 'Live',
      legs: [
        {
          'underlying-symbol': 'AAPL',
          symbol: 'AAPL250101C00100000',
          action: 'Buy to Close',
          'instrument-type': 'Equity Option',
          'option-type': 'C',
          quantity: 1,
        },
      ],
    };
    const result = normalizeWorkingCallReservations([order]);
    expect(result.bySymbol.AAPL).toBeUndefined();
  });

  it('fails closed when a live sell-to-open leg cannot be attributed to any underlying', () => {
    const order: RawOrderLike = {
      status: 'Live',
      legs: [
        {
          symbol: undefined,
          action: 'Sell to Open',
          'instrument-type': 'Equity Option',
          quantity: 1,
        },
      ],
    };
    const result = normalizeWorkingCallReservations([order]);
    expect(result.hasUnattributableExposure).toBe(true);
    expect(Object.keys(result.bySymbol)).toHaveLength(0);
  });

  it('conservatively reserves and flags an unclassifiable sell-to-open leg', () => {
    const order: RawOrderLike = {
      status: 'Live',
      legs: [
        {
          'underlying-symbol': 'AAPL',
          symbol: 'not-a-valid-occ-symbol',
          action: 'Sell to Open',
          'instrument-type': 'Equity Option',
          quantity: 1,
        },
      ],
    };
    const result = normalizeWorkingCallReservations([order]);
    expect(result.bySymbol.AAPL).toBe(1);
    expect(result.unclassifiedSymbols.has('AAPL')).toBe(true);
  });
});

describe('normalizeWorkingOrders', () => {
  it('produces the narrow WorkingOrder/WorkingOrderLeg shape, never leaking raw broker field names', () => {
    const result = normalizeWorkingOrders([sellToOpenCallOrder('AAPL', 2)], 'ACC1');
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      accountNumber: 'ACC1',
      orderId: 'ord-AAPL',
      status: 'Live',
    });
    expect(result[0].legs[0]).toMatchObject({
      underlyingSymbol: 'AAPL',
      action: 'Sell to Open',
      instrumentType: 'Equity Option',
      optionType: 'C',
      quantity: 2,
    });
  });

  it('carries the passed-in accountNumber onto every order, keeping accounts distinct', () => {
    const raw = [sellToOpenCallOrder('AAPL', 1)];
    const acc1 = normalizeWorkingOrders(raw, 'ACC1');
    const acc2 = normalizeWorkingOrders(raw, 'ACC2');
    expect(acc1[0].accountNumber).toBe('ACC1');
    expect(acc2[0].accountNumber).toBe('ACC2');
  });
});
