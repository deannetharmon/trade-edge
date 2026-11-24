import { describe, it, expect } from 'vitest';
import { deriveStockEntry, describeStockEntry } from '../entryFromTransactions';

const equity = (over: Record<string, any>) => ({ 'instrument-type': 'Equity', 'transaction-type': 'Receive Deliver', symbol: 'METU', quantity: 100, price: 27, 'transaction-sub-type': 'Buy to Open', 'executed-at': '2026-11-14T15:00:00Z', ...over });
const putAssignment = { 'instrument-type': 'Equity Option', 'transaction-type': 'Receive Deliver', 'transaction-sub-type': 'Assignment', symbol: 'METU  261114P00027000', quantity: 1, 'executed-at': '2026-11-14T15:00:00Z' };

describe('deriveStockEntry', () => {
  it('reads an assignment: strike price and assignment day', () => {
    const e = deriveStockEntry({ transactions: [putAssignment, equity({})], symbol: 'METU', sharesOwned: 100 });
    expect(e?.latest).toMatchObject({ day: '2026-11-14', price: 27, source: 'assignment', strike: 27 });
    expect(describeStockEntry(e!, '2026-11-24')).toBe('Assigned Nov 14 @ $27');
  });
  it('reads an outright buy', () => {
    const e = deriveStockEntry({ transactions: [equity({ 'transaction-type': 'Trade', price: 28.5, 'executed-at': '2026-08-03T14:00:00Z' })], symbol: 'METU', sharesOwned: 100 });
    expect(e?.latest).toMatchObject({ day: '2026-08-03', price: 28.5, source: 'buy' });
    expect(describeStockEntry(e!, '2026-11-24')).toBe('Bought Aug 3 @ $28.50');
  });
  it('first in first out: a partial sale leaves the newer lot open', () => {
    const tx = [
      equity({ 'transaction-type': 'Trade', price: 20, 'executed-at': '2026-06-01T14:00:00Z' }),
      equity({ 'transaction-type': 'Trade', price: 30, 'executed-at': '2026-09-01T14:00:00Z' }),
      equity({ 'transaction-type': 'Trade', 'transaction-sub-type': 'Sell to Close', price: 25, 'executed-at': '2026-10-01T14:00:00Z' }),
    ];
    const e = deriveStockEntry({ transactions: tx, symbol: 'METU', sharesOwned: 100 });
    expect(e?.lots).toHaveLength(1);
    expect(e?.latest).toMatchObject({ day: '2026-09-01', price: 30 });
  });
  it('several open lots: latest date, weighted average price', () => {
    const tx = [
      equity({ 'transaction-type': 'Trade', price: 20, 'executed-at': '2026-06-01T14:00:00Z' }),
      putAssignment, equity({}),
    ];
    const e = deriveStockEntry({ transactions: tx, symbol: 'METU', sharesOwned: 200 });
    expect(e?.averagePrice).toBe(23.5);
    expect(describeStockEntry(e!, '2026-11-24')).toBe('Assigned Nov 14 @ $27 (latest of 2 lots)');
  });
  it('returns null when the history cannot explain the shares held', () => {
    expect(deriveStockEntry({ transactions: [equity({})], symbol: 'METU', sharesOwned: 300 })).toBeNull();
    expect(deriveStockEntry({ transactions: [], symbol: 'METU', sharesOwned: 100 })).toBeNull();
  });
});
