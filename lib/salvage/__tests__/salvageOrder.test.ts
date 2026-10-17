import { describe, expect, it, vi } from 'vitest';
import type { Position } from '@/lib/portfolio-data/types';
import type { WingRow } from '../salvageCandidates';
import { parseSalvageDryRun } from '../salvageDryRun';
import { buildSalvageOrder, guardSalvageSubmit, submitSalvageOrderIfSafe, type SalvageReviewed } from '../salvageOrder';

const OCC = 'MRNA  261120P00110000';
const pos = (over: Record<string, unknown> = {}): Position => ({
  key: 'k', symbol: 'MRNA', accountNumber: 'ACCT1', expDate: '2026-11-20', dte: 35, quantity: 1,
  structureAmbiguous: false, structureBlockMessage: null, pairedShortCallKey: null, hasGtc: false,
  legs: [{ optionType: 'P', strikePrice: 140, direction: 'Long', quantity: 1, currentPrice: 2.08 }],
  identity: { structureType: 'NAKED', quantity: 1, entryPriceEffect: 'Debit', entryTotalCashFlowDollars: -2574 },
  ...over,
} as unknown as Position);
const row = (over: Partial<WingRow> = {}): WingRow => ({
  strike: 110, occSymbol: OCC, bid: 0.5, ask: 0.55, delta: -0.02, creditNet: 48.86, maxFromToday: 3048.86,
  objective: null, warnings: [], proposable: true, ...over,
});
const reviewed: SalvageReviewed = {
  accountNumber: 'ACCT1', right: 'P', strike: 140, expDate: '2026-11-20', quantity: 1,
  wingStrike: 110, wingOcc: OCC, wingQuantity: 1, pricePerShare: 0.5,
};

describe('buildSalvageOrder', () => {
  it('is one Sell to Open leg, Day limit at the bid, Credit, OCC symbol kept exactly', () => {
    const r = buildSalvageOrder({ occSymbol: OCC, quantity: 1, bid: 0.5, tickTable: null });
    expect(r).toEqual({
      ok: true, pricePerShare: 0.5,
      order: { 'time-in-force': 'Day', 'order-type': 'Limit', price: '0.50', 'price-effect': 'Credit', legs: [{ symbol: OCC, quantity: 1, action: 'Sell to Open', 'order-leg-type': 'Equity Option' }] },
    });
  });
  it('rounds to the option tick', () => {
    const table = [{ threshold: 3, value: 0.01 }, { threshold: null, value: 0.05 }];
    expect(buildSalvageOrder({ occSymbol: OCC, quantity: 1, bid: 3.07, tickTable: table })).toMatchObject({ ok: true, pricePerShare: 3.05 });
  });
  it('rejects a missing symbol, bad quantity, or no bid', () => {
    expect(buildSalvageOrder({ occSymbol: null, quantity: 1, bid: 0.5, tickTable: null }).ok).toBe(false);
    expect(buildSalvageOrder({ occSymbol: OCC, quantity: 0, bid: 0.5, tickTable: null }).ok).toBe(false);
    expect(buildSalvageOrder({ occSymbol: OCC, quantity: 1, bid: 0, tickTable: null }).ok).toBe(false);
  });
});

describe('guardSalvageSubmit', () => {
  const base = { reviewed, freshPosition: pos(), freshRow: row(), tickTable: null };
  it('allows when nothing moved', () => {
    expect(guardSalvageSubmit(base)).toMatchObject({ allowed: true, pricePerShare: 0.5 });
  });
  it.each([
    ['position gone', { freshPosition: null }, /no longer open/],
    ['different account', { freshPosition: pos({ accountNumber: 'OTHER' }) }, /different account/],
    ['working closing order', { freshPosition: pos({ hasGtc: true }) }, /closing order/],
    ['quantity changed', { freshPosition: pos({ identity: { structureType: 'NAKED', quantity: 2, entryPriceEffect: 'Debit', entryTotalCashFlowDollars: -5148 } }) }, /changed/],
    ['strike no longer listed', { freshRow: null }, /no longer available/],
    ['different option', { freshRow: row({ occSymbol: 'MRNA  261120P00100000' }) }, /does not match/],
    ['stale quote', { freshRow: row({ proposable: false }) }, /60 seconds/],
  ])('blocks: %s', (_n, over, re) => {
    const g = guardSalvageSubmit({ ...base, ...over } as never);
    expect(g.allowed).toBe(false);
    expect((g as { reason: string }).reason).toMatch(re);
  });
  it('blocks when the bid moved and says so', () => {
    const g = guardSalvageSubmit({ ...base, freshRow: row({ bid: 0.45 }) });
    expect(g).toMatchObject({ allowed: false, priceMoved: true });
  });
  it('blocks a wing larger than the long leg', () => {
    expect(guardSalvageSubmit({ ...base, reviewed: { ...reviewed, wingQuantity: 2 } }).allowed).toBe(false);
  });
});

describe('submitSalvageOrderIfSafe', () => {
  it('sends exactly once when allowed', async () => {
    const send = vi.fn().mockResolvedValue({ orderId: '42' });
    const r = await submitSalvageOrderIfSafe({ reviewed, freshPosition: pos(), freshRow: row(), tickTable: null }, send);
    expect(r).toEqual({ submitted: true, result: { orderId: '42' } });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][1]).toBe('ACCT1');
  });
  it('never calls the broker when blocked', async () => {
    const send = vi.fn();
    const r = await submitSalvageOrderIfSafe({ reviewed, freshPosition: pos(), freshRow: row({ bid: 0.4 }), tickTable: null }, send);
    expect(r.submitted).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });
});

describe('parseSalvageDryRun', () => {
  it('reads a clean response with buying power and fees', () => {
    const r = parseSalvageDryRun(true, { data: { 'buying-power-effect': { 'change-in-buying-power': '0.00', 'change-in-buying-power-effect': 'Debit' }, 'fee-calculation': { 'total-fees': '0.15' }, warnings: [{ message: 'Check it' }] } });
    expect(r).toEqual({ valid: true, errors: [], warnings: ['Check it'], buyingPowerChange: 0, fees: 0.15 });
  });
  it('a credit effect frees buying power', () => {
    const r = parseSalvageDryRun(true, { data: { 'buying-power-effect': { 'change-in-buying-power': '500', 'change-in-buying-power-effect': 'Credit' } } });
    expect(r.buyingPowerChange).toBe(-500);
  });
  it('errors make it invalid; HTTP failure reports the broker message', () => {
    expect(parseSalvageDryRun(true, { data: { errors: [{ message: 'Insufficient buying power' }] } })).toMatchObject({ valid: false, errors: ['Insufficient buying power'] });
    expect(parseSalvageDryRun(false, { error: { message: 'Bad price' } })).toMatchObject({ valid: false, errors: ['Bad price'] });
    expect(parseSalvageDryRun(false, {}).valid).toBe(false);
  });
});
