import { describe, expect, it } from 'vitest';
import { buildCreditEntryOtoco } from '../entryBracket';

const legs = [
  { 'instrument-type': 'Equity Option', symbol: 'SPY  261016P00580000', quantity: 1, action: 'Sell to Open' },
  { 'instrument-type': 'Equity Option', symbol: 'SPY  261016P00575000', quantity: 1, action: 'Buy to Open' },
];

describe('buildCreditEntryOtoco', () => {
  it('makes the profit and stop exits one contingent OCO pair', () => {
    const order = buildCreditEntryOtoco({ entryCredit: 1.25, profitBuyback: 0.63, stopTrigger: 2.50, stopLimit: 2.75, quantity: 3, legs });

    expect(order.type).toBe('OTOCO');
    expect(order['trigger-order']).toMatchObject({ 'order-type': 'Limit', 'time-in-force': 'GTC', price: '1.25', 'price-effect': 'Credit' });
    expect(order.orders).toHaveLength(2);
    expect(order.orders[0]).toMatchObject({ 'order-type': 'Limit', 'time-in-force': 'GTC', price: '0.63', 'price-effect': 'Debit' });
    expect(order.orders[1]).toMatchObject({ 'order-type': 'Stop Limit', 'time-in-force': 'GTC', 'stop-trigger': '2.50', price: '2.75', 'price-effect': 'Debit' });
    expect(order.orders[0].legs).toEqual([
      expect.objectContaining({ action: 'Buy to Close', quantity: 3 }),
      expect.objectContaining({ action: 'Sell to Close', quantity: 3 }),
    ]);
  });

  it('rejects a bracket that cannot represent a protective profit/stop pair', () => {
    expect(() => buildCreditEntryOtoco({ entryCredit: 1.25, profitBuyback: 1.25, stopTrigger: 2.50, stopLimit: 2.75, quantity: 1, legs })).toThrow('Profit target');
    expect(() => buildCreditEntryOtoco({ entryCredit: 1.25, profitBuyback: 0.63, stopTrigger: 2.50, stopLimit: 2.25, quantity: 1, legs })).toThrow('Stop limit');
  });
});
