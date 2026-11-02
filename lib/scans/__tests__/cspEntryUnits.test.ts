// lib/scans/__tests__/cspEntryUnits.test.ts
//
// CSP-UNITS-0001 -- payload-level pin of what the CSP order modal sends to the
// broker. Entry, buyback and stop prices must be PER SHARE (6.80), never the
// total-dollar scan credit (680.00).
//
// CSP-STOP-0001 -- a CSP carries NO stop by default (entry + GTC profit target as an OTO). The stop-limit
// exit (OTOCO) is sent only when stopEnabled is explicitly true.

import { describe, it, expect } from 'vitest';
import { cspEntryLimitPerShare, cspPerShareToContractDollars, cspBreakevenPerShare, buildCspEntryPayload } from '../cspEntryUnits';
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

describe('buildCspEntryPayload with the stop opted in (OTOCO)', () => {
  it('sends per-share prices for a 6.80 entry, 50% target and 2x stop', () => {
    const p: any = buildCspEntryPayload({ entryPerShare: 6.8, gtcPct: 50, stopMultiple: 2, quantity: 1, leg, stopEnabled: true });
    expect(p.type).toBe('OTOCO');
    expect(p['trigger-order'].price).toBe('6.80');
    expect(p.orders[0].price).toBe('3.40');
    expect(p.orders[1]['order-type']).toBe('Stop Limit');
    expect(p.orders[1]['stop-trigger']).toBe('13.60');
    expect(p.orders[1].price).toBe('14.96');
  });
  it('keeps prices per share at quantity 2 and scales only the leg quantity', () => {
    const p: any = buildCspEntryPayload({ entryPerShare: 6.8, gtcPct: 50, stopMultiple: 2, quantity: 2, leg, stopEnabled: true });
    expect(p['trigger-order'].price).toBe('6.80');
    expect(p['trigger-order'].legs[0].quantity).toBe(2);
  });
  it('reproduces the 10/30 SOXL case: a 2.10 credit gives a 4.20 trigger and a 4.65 limit on the tick', () => {
    const table = [{ threshold: 3, value: 0.01 }, { threshold: null, value: 0.05 }] as any;
    const p: any = buildCspEntryPayload({ entryPerShare: 2.1, gtcPct: 50, stopMultiple: 2, quantity: 1, leg, tickTable: table, stopEnabled: true });
    expect(p.orders[1]['stop-trigger']).toBe('4.20');
    expect(p.orders[1].price).toBe('4.65');
  });
});

describe('buildCspEntryPayload default (no stop)', () => {
  it('is an OTO with the entry and one GTC profit target and no Stop Limit order', () => {
    const p: any = buildCspEntryPayload({ entryPerShare: 2.1, gtcPct: 50, stopMultiple: 2, quantity: 1, leg });
    expect(p.type).toBe('OTO');
    expect(p['trigger-order'].price).toBe('2.10');
    expect(p['trigger-order']['price-effect']).toBe('Credit');
    expect(p.orders).toHaveLength(1);
    expect(p.orders[0].price).toBe('1.05');
    expect(p.orders[0]['order-type']).toBe('Limit');
    expect(p.orders[0].legs[0].action).toBe('Buy to Close');
    expect(JSON.stringify(p)).not.toMatch(/Stop/);
  });
  it('sends no stop when stopEnabled is false, even with a stop multiple set', () => {
    const p: any = buildCspEntryPayload({ entryPerShare: 6.8, gtcPct: 50, stopMultiple: 4, quantity: 1, leg, stopEnabled: false });
    expect(p.type).toBe('OTO');
    expect(p.orders).toHaveLength(1);
    expect(JSON.stringify(p)).not.toMatch(/stop/i);
  });
  it('treats anything other than an explicit true as no stop', () => {
    const p: any = buildCspEntryPayload({ entryPerShare: 6.8, gtcPct: 50, stopMultiple: 2, quantity: 1, leg, stopEnabled: undefined });
    expect(p.type).toBe('OTO');
  });
  it('keeps the profit target on the tick and below the entry', () => {
    const table = [{ threshold: 3, value: 0.01 }, { threshold: null, value: 0.05 }] as any;
    const p: any = buildCspEntryPayload({ entryPerShare: 3.2, gtcPct: 50, stopMultiple: 2, quantity: 1, leg, tickTable: table });
    expect(Number(p.orders[0].price)).toBeLessThan(3.2);
    expect(Math.round(Number(p.orders[0].price) * 100) % 5).toBe(0);
  });
});

describe('cspBreakevenPerShare', () => {
  it('is strike minus the credit received, to the cent', () => {
    expect(cspBreakevenPerShare(55, 2.1)).toBe(52.9);
    expect(cspBreakevenPerShare(90, 6.8)).toBe(83.2);
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
