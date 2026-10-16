// lib/tradeLookup/__tests__/orderHandoff.test.ts

import { describe, expect, it } from 'vitest';
import { buildLookup } from '../buildLookup';
import { applyFlags } from '../flags';
import { buildCcOrderInput, buildCspOrderResult, ccHandoffBlockReason, handoffBlockReason } from '../orderHandoff';
import { cspEntryLimitPerShare } from '@/lib/scans/cspEntryUnits';
import { contract, row } from './fixtures';

const today = { year: 2026, month: 10, day: 15 };
const cov = { status: 'not_applicable' as const, contractsNeeded: 1, canOrder: true, message: '' };

function csp(rows = [row(115), row(120), row(125)], contracts = 1) {
  return applyFlags(buildLookup({
    contract: contract(), expiration: '2026-11-06', nextExpiration: null, contracts, rows, underlyingPrice: 135, classification: 'etf', today, coverage: cov,
  }));
}

describe('buildCspOrderResult', () => {
  it('builds what the CSP order dialog reads', () => {
    const r = csp();
    const out = buildCspOrderResult(r, r.pick!)!;
    expect(out.symbol).toBe('SOXL');
    expect(out.underlyingType).toBe('etf');
    const c = out.bestCandidate!;
    expect(c.strategy).toBe('CSP');
    expect(c.shortStrike).toBe(120);
    expect(c.expiration).toBe('2026-11-06');
    expect(c.shortOccSymbol).toBe(r.pick!.occSymbol);
    expect(c.cspMid).toBeCloseTo(5.5, 10);
    expect(c.shortDelta).toBeCloseTo(0.3, 10);
  });

  it('keeps the dialog units: credit is total dollars, the entry limit prefills per share at mid', () => {
    const r = csp(undefined, 2);
    const c = buildCspOrderResult(r, r.pick!)!.bestCandidate!;
    expect(c.credit).toBeCloseTo(1100, 6);
    expect(cspEntryLimitPerShare(c)).toBe(5.5);
    expect(c.requiredCash).toBe(24000);
  });

  it('works for a neighbor row, not just the pick', () => {
    const r = csp();
    const nb = r.rows.filter((x) => x.strike === 115)[0];
    expect(buildCspOrderResult(r, nb)!.bestCandidate!.shortStrike).toBe(115);
  });

  it('refuses a no-quote row', () => {
    const r = csp([row(115, { bid: 0, ask: 0 }), row(120)]);
    const nq = r.rows.filter((x) => x.strike === 115)[0];
    expect(handoffBlockReason(r, nq)).toBe('no_quote');
    expect(buildCspOrderResult(r, nq)).toBeNull();
  });

  it('refuses a row with no option symbol', () => {
    const r = csp([row(120, { occSymbol: '' })]);
    expect(handoffBlockReason(r, r.pick!)).toBe('no_symbol');
  });

  it('refuses covered calls', () => {
    const r = applyFlags(buildLookup({
      contract: contract({ strategy: 'CC', right: 'C' }), expiration: '2026-11-06', nextExpiration: null, contracts: 1,
      rows: [row(120, { right: 'C' })], underlyingPrice: 100, classification: 'etf', today,
      coverage: { status: 'covered_by_shares', contractsNeeded: 1, canOrder: true, message: '' },
    }));
    expect(handoffBlockReason(r, r.pick!)).toBe('not_csp');
    expect(buildCspOrderResult(r, r.pick!)).toBeNull();
  });

  it('refuses a row that is not from this result', () => {
    const r = csp();
    expect(handoffBlockReason(r, Object.assign({}, r.pick!))).toBe('wrong_row');
  });
});

describe('buildCcOrderInput', () => {
  const cc = (canOrder = true, rows = [row(16, { right: 'C', delta: 0.25 })], classification: 'etf' | 'index' = 'etf', contracts = 2) => applyFlags(buildLookup({
    contract: contract({ strategy: 'CC', right: 'C', ticker: 'BITX', strike: 16 }), expiration: '2026-11-06', nextExpiration: null, contracts,
    rows, underlyingPrice: 15, classification, today,
    coverage: { status: canOrder ? 'covered_by_shares' : 'not_covered', contractsNeeded: contracts, canOrder, message: '' },
  }));

  it('builds the call dialog input from a covered call row', () => {
    const r = cc();
    const out = buildCcOrderInput(r, r.rows[0])!;
    expect(out).toMatchObject({ symbol: 'BITX', strike: 16, expiration: '2026-11-06', isIndex: false, initialQuantity: 2 });
    expect(out.occSymbol).toBe(r.rows[0].occSymbol);
    expect(out.delta).toBe(0.25);
    expect(out.midPerShare).toBeCloseTo(r.rows[0].mid as number, 2);
  });
  it('marks index underlyings', () => {
    const r = cc(true, [row(16, { right: 'C' })], 'index');
    expect(buildCcOrderInput(r, r.rows[0])!.isIndex).toBe(true);
  });
  it('refuses when coverage is not proven', () => {
    const r = cc(false);
    expect(ccHandoffBlockReason(r, r.rows[0])).toBe('not_covered');
    expect(buildCcOrderInput(r, r.rows[0])).toBeNull();
  });
  it('refuses no-quote, no-symbol, foreign rows, and puts', () => {
    const nq = cc(true, [row(16, { right: 'C', bid: 0, ask: 0 })]);
    expect(ccHandoffBlockReason(nq, nq.rows[0])).toBe('no_quote');
    const ns = cc(true, [row(16, { right: 'C', occSymbol: '' })]);
    expect(ccHandoffBlockReason(ns, ns.rows[0])).toBe('no_symbol');
    const r = cc();
    expect(ccHandoffBlockReason(r, Object.assign({}, r.rows[0]))).toBe('wrong_row');
    const put = csp();
    expect(ccHandoffBlockReason(put, put.pick!)).toBe('not_cc');
  });
});
