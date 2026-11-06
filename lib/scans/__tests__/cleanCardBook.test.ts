// lib/scans/__tests__/cleanCardBook.test.ts

import { describe, it, expect } from 'vitest';
import { buildAllocBook, putStrikeFromOcc } from '../cleanCardBook';

describe('putStrikeFromOcc', () => {
  it('reads the strike of a put and ignores calls', () => {
    expect(putStrikeFromOcc('KO    261113P00090000')).toBe(90);
    expect(putStrikeFromOcc('KO    261113C00090000')).toBeNull();
    expect(putStrikeFromOcc(undefined)).toBeNull();
  });
});

describe('buildAllocBook', () => {
  const bal = { 'net-liquidating-value': '100000.00' };
  it('counts long shares at close and short puts at strike x 100 x contracts', () => {
    const book = buildAllocBook(bal, [
      { 'instrument-type': 'Equity', symbol: 'KO', quantity: '50', 'quantity-direction': 'Long', 'close-price': '80' },
      { 'instrument-type': 'Equity Option', symbol: 'KO    261113P00090000', 'underlying-symbol': 'KO', quantity: '2', 'quantity-direction': 'Short', multiplier: '100' },
    ])!;
    expect(book.netLiq).toBe(100000);
    expect(book.bySymbol.KO).toBe(4000 + 18000);
  });
  it('ignores long options, short calls and short stock', () => {
    const book = buildAllocBook(bal, [
      { 'instrument-type': 'Equity Option', symbol: 'KO    261113P00090000', 'underlying-symbol': 'KO', quantity: '1', 'quantity-direction': 'Long' },
      { 'instrument-type': 'Equity Option', symbol: 'KO    261113C00090000', 'underlying-symbol': 'KO', quantity: '1', 'quantity-direction': 'Short' },
      { 'instrument-type': 'Equity', symbol: 'PEP', quantity: '10', 'quantity-direction': 'Short', 'close-price': '150' },
    ])!;
    expect(book.bySymbol).toEqual({});
  });
  it('fails closed without net liquidation or positions', () => {
    expect(buildAllocBook({}, [])).toBeNull();
    expect(buildAllocBook({ 'net-liquidating-value': '0' }, [])).toBeNull();
    expect(buildAllocBook(bal, null)).toBeNull();
  });
});
