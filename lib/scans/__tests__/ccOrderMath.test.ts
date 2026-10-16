// lib/scans/__tests__/ccOrderMath.test.ts

import { describe, expect, it } from 'vitest';
import { buildCcOrderLeg, buildCreditEntryOto, ccProfitBuyback, computeCcAssignment } from '../ccOrderMath';

describe('buildCcOrderLeg', () => {
  it('builds one Sell to Open leg', () => {
    const r = buildCcOrderLeg('BITX  261106C00016000', 2, false);
    expect(r).toEqual({ ok: true, leg: { 'instrument-type': 'Equity Option', symbol: 'BITX  261106C00016000', quantity: 2, action: 'Sell to Open' } });
  });
  it('uses Index Option for indexes', () => {
    const r = buildCcOrderLeg('SPXW  261106C05000000', 1, true);
    expect(r.ok && r.leg['instrument-type']).toBe('Index Option');
  });
  it('refuses a missing symbol and bad quantities', () => {
    expect(buildCcOrderLeg(null, 1, false).ok).toBe(false);
    expect(buildCcOrderLeg('', 1, false).ok).toBe(false);
    expect(buildCcOrderLeg('X', 0, false).ok).toBe(false);
    expect(buildCcOrderLeg('X', 1.5, false).ok).toBe(false);
  });
});

describe('ccProfitBuyback', () => {
  it('is entry x (1 - pct), to the cent', () => {
    expect(ccProfitBuyback(0.4, 50)).toBe(0.2);
    expect(ccProfitBuyback(1.07, 50)).toBe(0.54);
    expect(ccProfitBuyback(5.5, 50)).toBe(2.75);
  });
  it('never goes below one tick', () => {
    expect(ccProfitBuyback(0.01, 50)).toBe(0.01);
    expect(ccProfitBuyback(0.02, 90)).toBe(0.01);
  });
  it('rejects bad inputs', () => {
    expect(() => ccProfitBuyback(0, 50)).toThrow();
    expect(() => ccProfitBuyback(1, 0)).toThrow();
    expect(() => ccProfitBuyback(1, 100)).toThrow();
    expect(() => ccProfitBuyback(Number.NaN, 50)).toThrow();
  });
});

describe('buildCreditEntryOto', () => {
  const leg = { 'instrument-type': 'Equity Option', symbol: 'BITX  261106C00016000', quantity: 1, action: 'Sell to Open' };
  it('is one entry and exactly one GTC buy-to-close, with NO stop', () => {
    const p = buildCreditEntryOto({ entryPerShare: 0.4, profitBuybackPerShare: 0.2, quantity: 3, leg });
    expect(p.type).toBe('OTO');
    expect(p['trigger-order']).toMatchObject({ 'time-in-force': 'GTC', 'order-type': 'Limit', price: '0.40', 'price-effect': 'Credit' });
    expect(p['trigger-order'].legs).toEqual([{ ...leg, quantity: 3, action: 'Sell to Open' }]);
    expect(p.orders).toHaveLength(1);
    expect(p.orders[0]).toMatchObject({ 'time-in-force': 'GTC', 'order-type': 'Limit', price: '0.20', 'price-effect': 'Debit' });
    expect(p.orders[0].legs).toEqual([{ ...leg, quantity: 3, action: 'Buy to Close' }]);
    expect(JSON.stringify(p)).not.toMatch(/Stop/);
  });
  it('prices are per share with two decimals', () => {
    const p = buildCreditEntryOto({ entryPerShare: 1.1, profitBuybackPerShare: 0.55, quantity: 1, leg });
    expect(p['trigger-order'].price).toBe('1.10');
    expect(p.orders[0].price).toBe('0.55');
  });
  it('does not change the input leg', () => {
    buildCreditEntryOto({ entryPerShare: 1, profitBuybackPerShare: 0.5, quantity: 2, leg });
    expect(leg.quantity).toBe(1);
    expect(leg.action).toBe('Sell to Open');
  });
  it('refuses bad input', () => {
    const base = { entryPerShare: 1, profitBuybackPerShare: 0.5, quantity: 1, leg };
    expect(() => buildCreditEntryOto({ ...base, quantity: 0 })).toThrow();
    expect(() => buildCreditEntryOto({ ...base, entryPerShare: 0 })).toThrow();
    expect(() => buildCreditEntryOto({ ...base, profitBuybackPerShare: 0 })).toThrow();
    expect(() => buildCreditEntryOto({ ...base, profitBuybackPerShare: 1 })).toThrow();
    expect(() => buildCreditEntryOto({ ...base, leg: { ...leg, action: 'Buy to Open' } })).toThrow();
  });
});

describe('computeCcAssignment', () => {
  it('computes proceeds, premium and gain against cost basis', () => {
    const r = computeCcAssignment({ strike: 16, creditPerShare: 0.4, costBasis: 14.5, quantity: 2 });
    expect(r.proceeds).toBe(3200);
    expect(r.premium).toBe(80);
    expect(r.gainVsCostBasis).toBe(300);
    expect(r.gainVsCostBasisWithPremium).toBe(380);
    expect(r.belowCostBasis).toBe(false);
  });
  it('below cost basis: a loss before premium, and the flag', () => {
    const r = computeCcAssignment({ strike: 16, creditPerShare: 0.4, costBasis: 18, quantity: 1 });
    expect(r.gainVsCostBasis).toBe(-200);
    expect(r.gainVsCostBasisWithPremium).toBe(-160);
    expect(r.belowCostBasis).toBe(true);
  });
  it('strike equal to cost basis is not below', () => {
    expect(computeCcAssignment({ strike: 16, creditPerShare: 0.4, costBasis: 16, quantity: 1 }).belowCostBasis).toBe(false);
  });
  it('unknown cost basis gives no numbers and no flag', () => {
    for (const cb of [null, 0, -1, Number.NaN]) {
      const r = computeCcAssignment({ strike: 16, creditPerShare: 0.4, costBasis: cb, quantity: 1 });
      expect(r.gainVsCostBasis).toBeNull();
      expect(r.gainVsCostBasisWithPremium).toBeNull();
      expect(r.belowCostBasis).toBe(false);
    }
  });
  it('avoids floating-point noise', () => {
    expect(computeCcAssignment({ strike: 0.3, creditPerShare: 0.1, costBasis: 0.2, quantity: 1 }).gainVsCostBasis).toBe(10);
  });
  it('rejects bad inputs', () => {
    expect(() => computeCcAssignment({ strike: 0, creditPerShare: 0.4, costBasis: null, quantity: 1 })).toThrow();
    expect(() => computeCcAssignment({ strike: 16, creditPerShare: -1, costBasis: null, quantity: 1 })).toThrow();
    expect(() => computeCcAssignment({ strike: 16, creditPerShare: 0.4, costBasis: null, quantity: 0 })).toThrow();
  });
});
