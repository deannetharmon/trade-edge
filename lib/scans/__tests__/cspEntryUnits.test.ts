// lib/scans/__tests__/cspEntryUnits.test.ts
//
// CSP-UNITS-0001 -- payload-level pin of what the CSP order modal sends to the
// broker. Entry, buyback and stop prices must be PER SHARE (6.80), never the
// total-dollar scan credit (680.00).

import { describe, it, expect } from 'vitest';
import { cspEntryLimitPerShare, cspPerShareToContractDollars, buildCspEntryPayload } from '../cspEntryUnits';
import { computeCspMaxLoss } from '../cspOrderMath';

const leg = { 'instrument-type': 'Equity Option', symbol: 'SOXL  261120P00090000', quantity: 1, action: 'Sell to Open' };

describe('cspEntryLimitPerShare', () => {
  it('uses the per-share mid, not the total-dollar credit', () => {
    expect(cspEntryLimitPerShare({ cspMid: 6.8, credit: 680 })).toBe(6.8);
  });
  it('falls back to credit / 100 when no mid is present', () => {
    expect(cspEntryLimitPerShare({ credit: 680 })).toBe(6.8);
  });
  it('returns 0 when nothing usable is present', () => {
    expect(cspEntryLimitPerShare({})).toBe(0);
    expect(cspEntryLimitPerShare({ cspMid: 0, credit: 0 })).toBe(0);
  });
});

describe('buildCspEntryPayload', () => {
  it('sends per-share prices for a 6.80 entry, 50% target and 2x stop', () => {
    const p = buildCspEntryPayload({ entryPerShare: 6.8, gtcPct: 50, stopMultiple: 2, quantity: 1, leg });
    expect(p['trigger-order'].price).toBe('6.80');
    expect(p.orders[0].price).toBe('3.40');
    expect(p.orders[1]['stop-trigger']).toBe('13.60');
    expect(p.orders[1].price).toBe('14.96');
  });
  it('keeps prices per share at quantity 2 and scales only the leg quantity', () => {
    const p = buildCspEntryPayload({ entryPerShare: 6.8, gtcPct: 50, stopMultiple: 2, quantity: 2, leg });
    expect(p['trigger-order'].price).toBe('6.80');
    expect(p['trigger-order'].legs[0].quantity).toBe(2);
  });
});

describe('contract-dollar conversion for risk math', () => {
  it('converts per share to dollars per contract', () => {
    expect(cspPerShareToContractDollars(6.8)).toBe(680);
    expect(cspPerShareToContractDollars(6.55)).toBe(655);
  });
  it('gives the max loss shown in the modal ($8,320 for a 90P at $6.80)', () => {
    expect(computeCspMaxLoss(90, cspPerShareToContractDollars(6.8), 1)).toBe(8320);
  });
});
