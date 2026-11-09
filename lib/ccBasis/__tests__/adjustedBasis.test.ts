// lib/ccBasis/__tests__/adjustedBasis.test.ts
//
// CC-WHEEL-0001 S5 golden fixtures (Alan). Case 1 is the trader's real TQQQ history: two assignments, one of them a rolled put.
//   Lot A: 82 put sold 4.10, bought back 1.90 in a roll, re-sold 2.20, assigned -> 82 - 4.40 = 77.60
//   Lot B: 75.5 put sold 3.20, assigned                                         -> 75.5 - 3.20 = 72.30
//   200 shares, strike average 78.75 (= the broker's basis), adjusted basis (77.60 + 72.30) / 2 = 74.95

import { describe, expect, it } from 'vitest';
import { computeAdjustedBasis, describeAdjustedBasis, hasOpenLongCall } from '../adjustedBasis';

let seq = 0;
const opt = (symbol: string, action: string, qty: number, price: number, at: string, over: Record<string, unknown> = {}) => ({
  id: `o${seq += 1}`, 'instrument-type': 'Equity Option', 'transaction-type': 'Trade', 'transaction-sub-type': action, action,
  symbol, 'underlying-symbol': 'TQQQ', quantity: String(qty), price: String(price), value: String(price * qty * 100),
  'executed-at': at, commission: '0', 'clearing-fees': '0', 'regulatory-fees': '0', ...over,
});
const assign = (symbol: string, qty: number, at: string) => ({
  id: `a${seq += 1}`, 'instrument-type': 'Equity Option', 'transaction-type': 'Receive Deliver', 'transaction-sub-type': 'Assignment',
  symbol, 'underlying-symbol': 'TQQQ', quantity: String(qty), 'executed-at': at,
});
const shares = (qty: number, price: number, at: string) => ({
  id: `s${seq += 1}`, 'instrument-type': 'Equity', 'transaction-type': 'Receive Deliver', 'transaction-sub-type': 'Buy to Open', action: 'Buy to Open',
  symbol: 'TQQQ', 'underlying-symbol': 'TQQQ', quantity: String(qty), price: String(price), 'executed-at': at,
});

const P82_A = 'TQQQ  261016P00082000'; // first put, rolled
const P82_B = 'TQQQ  261106P00082000'; // rolled into, assigned
const P75 = 'TQQQ  261030P00075500';

const deanHistory = () => [
  opt(P82_A, 'Sell to Open', 1, 4.10, '2026-09-10T14:00:00.000+0000'),
  opt(P82_A, 'Buy to Close', 1, 1.90, '2026-10-12T15:00:00.000+0000', { 'order-id': 'R1' }),
  opt(P82_B, 'Sell to Open', 1, 2.20, '2026-10-12T15:00:00.000+0000', { 'order-id': 'R1' }),
  assign(P82_B, 1, '2026-11-06T21:00:00.000+0000'),
  shares(100, 82, '2026-11-06T21:00:00.000+0000'),
  opt(P75, 'Sell to Open', 1, 3.20, '2026-09-25T14:00:00.000+0000'),
  assign(P75, 1, '2026-10-30T21:00:00.000+0000'),
  shares(100, 75.5, '2026-10-30T21:00:00.000+0000'),
  // never assigned: must not count
  opt('TQQQ  261113P00059000', 'Sell to Open', 1, 1.00, '2026-10-20T14:00:00.000+0000'),
];
const base = { symbol: 'TQQQ', sharesOwned: 200, brokerBasis: 78.75 };

describe('computeAdjustedBasis', () => {
  it('golden: the trader\'s two assignments, one rolled, give 74.95', () => {
    const r = computeAdjustedBasis({ ...base, transactions: deanHistory() });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.strikeAverage).toBe(78.75);
    expect(r.basis).toBe(74.95);
    expect(r.lots).toHaveLength(2);
    expect(r.lots.find(l => l.strike === 82)?.premiumPerShare).toBe(4.4);
    expect(r.lots.find(l => l.strike === 75.5)?.premiumPerShare).toBe(3.2);
    expect(describeAdjustedBasis(r)).toBe('after put premium from your 2 assignments');
  });

  it('single assignment', () => {
    const r = computeAdjustedBasis({ symbol: 'TQQQ', sharesOwned: 100, brokerBasis: 75.5, transactions: [
      opt(P75, 'Sell to Open', 1, 3.2, '2026-09-25T14:00:00.000+0000'), assign(P75, 1, '2026-10-30T21:00:00.000+0000'), shares(100, 75.5, '2026-10-30T21:00:00.000+0000'),
    ] });
    expect(r).toMatchObject({ ok: true, basis: 72.3 });
  });

  it('fees come off the premium', () => {
    const r = computeAdjustedBasis({ symbol: 'TQQQ', sharesOwned: 100, brokerBasis: 75.5, transactions: [
      opt(P75, 'Sell to Open', 1, 3.2, '2026-09-25T14:00:00.000+0000', { commission: '1.00', 'clearing-fees': '0.10', 'regulatory-fees': '0.04' }),
      assign(P75, 1, '2026-10-30T21:00:00.000+0000'), shares(100, 75.5, '2026-10-30T21:00:00.000+0000'),
    ] });
    expect(r).toMatchObject({ ok: true, basis: 72.3114 }); // (320 - 1.14) / 100 = 3.1886 premium
  });

  it('fails closed when the shares are not all explained (some bought before the window)', () => {
    expect(computeAdjustedBasis({ ...base, sharesOwned: 300, transactions: deanHistory() })).toEqual({ ok: false, reason: 'SHARES_NOT_EXPLAINED' });
  });

  it('fails closed on a lot that did not come from an assignment (bought on the market)', () => {
    const tx = deanHistory().filter(t => t['transaction-type'] !== 'Receive Deliver' || t['instrument-type'] === 'Equity');
    expect(computeAdjustedBasis({ ...base, transactions: tx })).toEqual({ ok: false, reason: 'LOT_NOT_FROM_ASSIGNMENT' });
  });

  it('fails closed when the put\'s opening sale is outside the loaded history', () => {
    const tx = deanHistory().filter(t => t.symbol !== P75 || t['transaction-type'] !== 'Trade');
    expect(computeAdjustedBasis({ ...base, transactions: tx })).toEqual({ ok: false, reason: 'PUT_HISTORY_INCOMPLETE' });
  });

  it('a roll with no shared order id is not linked, so the earlier put\'s premium is left out (never overstated)', () => {
    const tx = deanHistory().map(t => (t.symbol === P82_B && t['transaction-sub-type'] === 'Sell to Open' ? { ...t, 'order-id': 'OTHER' } : t));
    // The first put's 4.10 sale and 1.90 buyback are no longer linked, so only the assigned put's own 2.20 counts.
    const r = computeAdjustedBasis({ ...base, transactions: tx });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.lots.find(l => l.strike === 82)?.premiumPerShare).toBe(2.2);
  });

  it('fails closed when two sales share one order with two buybacks', () => {
    const tx = [...deanHistory(), opt('TQQQ  261120P00070000', 'Buy to Close', 1, 0.5, '2026-10-12T15:00:00.000+0000', { 'order-id': 'R1' })];
    expect(computeAdjustedBasis({ ...base, transactions: tx })).toEqual({ ok: false, reason: 'ROLL_UNPROVABLE' });
  });

  it('fails closed when the broker basis is not the strike average (wash sale or other broker adjustment)', () => {
    expect(computeAdjustedBasis({ ...base, brokerBasis: 77.1, transactions: deanHistory() })).toEqual({ ok: false, reason: 'BROKER_BASIS_DIFFERS' });
    expect(computeAdjustedBasis({ ...base, brokerBasis: null, transactions: deanHistory() })).toEqual({ ok: false, reason: 'BROKER_BASIS_DIFFERS' });
  });

  it('fails closed with a long call on the stock (PMCC) or the stock in two accounts', () => {
    expect(computeAdjustedBasis({ ...base, hasLongCallOnSymbol: true, transactions: deanHistory() })).toEqual({ ok: false, reason: 'LONG_CALL_ON_SAME_STOCK' });
    expect(computeAdjustedBasis({ ...base, heldInMultipleAccounts: true, transactions: deanHistory() })).toEqual({ ok: false, reason: 'MULTIPLE_ACCOUNTS' });
  });

  it('fails closed on a partial assignment (put sold for 2, one assigned)', () => {
    const tx = [
      opt(P75, 'Sell to Open', 2, 3.2, '2026-09-25T14:00:00.000+0000'), assign(P75, 1, '2026-10-30T21:00:00.000+0000'), shares(100, 75.5, '2026-10-30T21:00:00.000+0000'),
    ];
    expect(computeAdjustedBasis({ symbol: 'TQQQ', sharesOwned: 100, brokerBasis: 75.5, transactions: tx })).toEqual({ ok: false, reason: 'PUT_HISTORY_INCOMPLETE' });
  });

  it('fails closed on two identical assignments the same day when the shares only explain one (no double counting)', () => {
    const tx = [
      opt(P75, 'Sell to Open', 1, 3.2, '2026-09-25T14:00:00.000+0000'), assign(P75, 1, '2026-10-30T21:00:00.000+0000'), assign(P75, 1, '2026-10-30T21:00:00.000+0000'),
      shares(100, 75.5, '2026-10-30T21:00:00.000+0000'),
    ];
    expect(computeAdjustedBasis({ symbol: 'TQQQ', sharesOwned: 100, brokerBasis: 75.5, transactions: tx })).toEqual({ ok: false, reason: 'ASSIGNMENT_AMBIGUOUS' });
  });

  it('shares sold since reduce the lots first-in-first-out', () => {
    const tx = [...deanHistory(), { id: 'sell1', 'instrument-type': 'Equity', 'transaction-type': 'Trade', 'transaction-sub-type': 'Sell to Close', action: 'Sell to Close', symbol: 'TQQQ', quantity: '100', price: '60', 'executed-at': '2026-11-07T15:00:00.000+0000' }];
    const r = computeAdjustedBasis({ symbol: 'TQQQ', sharesOwned: 100, brokerBasis: 82, transactions: tx });
    expect(r).toMatchObject({ ok: true, basis: 77.6 }); // the 75.50 lot (oldest) is gone; the 82 lot remains
  });
});

describe('hasOpenLongCall', () => {
  const call = 'TQQQ  270115C00040000';
  it('flags a long call still open, not one closed or expired', () => {
    expect(hasOpenLongCall([opt(call, 'Buy to Open', 1, 20, '2026-06-01T14:00:00.000+0000')], 'TQQQ')).toBe(true);
    expect(hasOpenLongCall([opt(call, 'Buy to Open', 1, 20, '2026-06-01T14:00:00.000+0000'), opt(call, 'Sell to Close', 1, 25, '2026-07-01T14:00:00.000+0000')], 'TQQQ')).toBe(false);
  });
  it('ignores short calls, puts and other stocks', () => {
    expect(hasOpenLongCall([opt(call, 'Sell to Open', 1, 2, '2026-06-01T14:00:00.000+0000'), opt(P75, 'Buy to Open', 1, 2, '2026-06-01T14:00:00.000+0000')], 'TQQQ')).toBe(false);
    expect(hasOpenLongCall([opt(call, 'Buy to Open', 1, 20, '2026-06-01T14:00:00.000+0000')], 'SOXL')).toBe(false);
  });
});
