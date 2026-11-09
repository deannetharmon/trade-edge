// lib/portfolio-snapshot/__tests__/committedCalls.test.ts
//
// CC-VISIBILITY-0001 slice 2. The list must never disagree with the capacity counts (quinn: parity on every fixture),
// and a detail the broker row does not carry is null, never guessed.

import { describe, expect, it } from 'vitest';
import { describeCommittedCall, formatExpiryShort, listCommittedShortCalls } from '../committedCalls';
import { normalizeShortCallExposure } from '../normalizeShortCallExposure';
import { normalizeWorkingCallReservations } from '../normalizeWorkingOrders';

const TQQQ_1218_63C = 'TQQQ  261218C00063000';
const TQQQ_0116_64C = 'TQQQ  270116C00064000';
const TQQQ_1218_50P = 'TQQQ  261218P00050000';

const position = (over: Record<string, unknown> = {}) => ({
  'instrument-type': 'Equity Option', 'underlying-symbol': 'TQQQ', symbol: TQQQ_1218_63C, 'quantity-direction': 'Short', quantity: 1,
  'average-open-price': '2.01', ...over,
});
const order = (over: Record<string, unknown> = {}, leg: Record<string, unknown> = {}) => ({
  id: 7, status: 'Live', legs: [{ 'instrument-type': 'Equity Option', 'underlying-symbol': 'TQQQ', symbol: TQQQ_0116_64C, action: 'Sell to Open', quantity: 1, ...leg }], ...over,
});

function counts(positions: unknown[], orders: unknown[]) {
  const existing = normalizeShortCallExposure(positions as never).bySymbol;
  const working = normalizeWorkingCallReservations(orders as never).bySymbol;
  const symbols = new Set([...Object.keys(existing), ...Object.keys(working)]);
  return Object.fromEntries(Array.from(symbols).map(s => [s, (existing[s] ?? 0) + (working[s] ?? 0)]));
}
function listed(positions: unknown[], orders: unknown[]) {
  const by = listCommittedShortCalls(positions as never, orders as never);
  return Object.fromEntries(Object.entries(by).map(([s, calls]) => [s, calls.reduce((n, c) => n + c.quantity, 0)]));
}

describe('listCommittedShortCalls', () => {
  it('lists a filled short call with its strike, expiry and premium', () => {
    const out = listCommittedShortCalls([position()] as never, []);
    expect(out.TQQQ).toEqual([{ status: 'filled', quantity: 1, strike: 63, expiration: '2026-12-18', premiumPerShare: 2.01, unclassified: false }]);
  });

  it('lists a working sell-to-open order as pending, after the filled call', () => {
    const out = listCommittedShortCalls([position()] as never, [order()] as never);
    expect(out.TQQQ.map(c => [c.status, c.strike, c.expiration])).toEqual([['filled', 63, '2026-12-18'], ['pending', 64, '2027-01-16']]);
    expect(out.TQQQ[1].premiumPerShare).toBeNull();
  });

  it('keeps a row with quantity above one as one row', () => {
    expect(listCommittedShortCalls([position({ quantity: 2 })] as never, [])?.TQQQ).toHaveLength(1);
    expect(listCommittedShortCalls([position({ quantity: 2 })] as never, [])?.TQQQ[0].quantity).toBe(2);
  });

  it('ignores what the capacity math ignores: long calls, short puts, closing orders, finished orders, stock', () => {
    const out = listCommittedShortCalls(
      [position({ 'quantity-direction': 'Long' }), position({ symbol: TQQQ_1218_50P }), { 'instrument-type': 'Equity', symbol: 'TQQQ', quantity: 200, 'quantity-direction': 'Long' }] as never,
      [order({}, { action: 'Buy to Close' }), order({ status: 'Cancelled' }), order({}, { symbol: TQQQ_1218_50P })] as never,
    );
    expect(out).toEqual({});
  });

  it('keeps an unclassifiable short option and flags it (counted as a call, like the capacity math); detail is null, not guessed', () => {
    const out = listCommittedShortCalls([position({ symbol: 'GARBAGE', 'option-type': undefined })] as never, []);
    expect(out.TQQQ).toEqual([{ status: 'filled', quantity: 1, strike: null, expiration: null, premiumPerShare: 2.01, unclassified: true }]);
  });

  it('is empty, not an error, with no data', () => {
    expect(listCommittedShortCalls(null, null)).toEqual({});
    expect(listCommittedShortCalls([], [])).toEqual({});
  });

  it('agrees with the capacity counts on every fixture (the one number on the card and the list can never differ)', () => {
    const fixtures: Array<[unknown[], unknown[]]> = [
      [[position()], []],
      [[position({ quantity: 2 })], [order()]],
      [[position(), position({ symbol: 'TQQQ  261225C00070000', quantity: 3 })], [order(), order({ id: 8 }, { quantity: 2 })]],
      [[position({ symbol: 'GARBAGE', 'option-type': undefined })], []],
      [[position({ 'quantity-direction': 'Long' }), position({ symbol: TQQQ_1218_50P })], [order({ status: 'Filled' }), order({}, { action: 'Buy to Close' })]],
      [[position({ 'underlying-symbol': 'SOXL', symbol: 'SOXL  261218C00050000' }), position()], [order({}, { 'underlying-symbol': 'SOXL', symbol: 'SOXL  261218C00055000' })]],
    ];
    for (const [positions, orders] of fixtures) expect(listed(positions, orders)).toEqual(counts(positions, orders));
  });
});

describe('describeCommittedCall', () => {
  const filled = { status: 'filled' as const, quantity: 1, strike: 63, expiration: '2026-12-18', premiumPerShare: 2.01, unclassified: false };

  it('reads like the card: strike, expiry, DTE, filled, premium', () => {
    expect(describeCommittedCall(filled, 39)).toBe('Short $63 call · Dec 18 · 39 DTE · filled · +$201');
  });
  it('reads a pending order and a multi-contract row', () => {
    expect(describeCommittedCall({ ...filled, status: 'pending', strike: 64, expiration: '2027-01-16', premiumPerShare: null }, 68)).toBe('Pending · $64 call · Jan 16 · 68 DTE');
    expect(describeCommittedCall({ ...filled, quantity: 2 }, 39)).toBe('Short $63 call · Dec 18 · 39 DTE · × 2 · filled · +$402');
  });
  it('says "detail unavailable" instead of guessing, and drops DTE it cannot know', () => {
    expect(describeCommittedCall({ ...filled, strike: null, expiration: null, premiumPerShare: null }, null)).toBe('Short call (detail unavailable) · filled');
    expect(describeCommittedCall(filled, null)).toBe('Short $63 call · Dec 18 · filled · +$201');
  });
  it('formatExpiryShort rejects non-dates', () => {
    expect(formatExpiryShort('2026-12-18')).toBe('Dec 18');
    expect(formatExpiryShort('nope')).toBeNull();
    expect(formatExpiryShort(null)).toBeNull();
  });
});
