// lib/tradeLookup/__tests__/flags.test.ts

import { describe, expect, it } from 'vitest';
import { buildLookup } from '../buildLookup';
import { applyFlags, defaultFlagRules, flagRow } from '../flags';
import { contract, row } from './fixtures';
import type { LookupRow } from '../lookupTypes';

const today = { year: 2026, month: 10, day: 15 };
const cov = { status: 'not_applicable' as const, contractsNeeded: 1, canOrder: true, message: '' };

function priced(over: Parameters<typeof row>[1] = {}, c = contract()): LookupRow {
  const r = buildLookup({
    contract: c, expiration: '2026-11-06', nextExpiration: null, contracts: 1,
    rows: [row(c.strike, Object.assign({ right: c.right }, over))], underlyingPrice: 135, classification: 'etf', today, coverage: cov,
  });
  return r.pick as LookupRow;
}
const codes = (r: LookupRow, strategy: 'CSP' | 'CC' = 'CSP', basis: number | null = null) =>
  flagRow(r, strategy, defaultFlagRules(strategy), basis).map((f) => f.code);

describe('flagRow', () => {
  it('delta inside the CSP band has no delta flag; outside has one (both sides)', () => {
    expect(codes(priced({ delta: -0.2 }))).not.toContain('delta_outside_band');
    expect(codes(priced({ delta: -0.3 }))).toContain('delta_outside_band');
    expect(codes(priced({ delta: -0.1 }))).toContain('delta_outside_band');
  });
  it('band edges pass', () => {
    expect(codes(priced({ delta: -0.15 }))).not.toContain('delta_outside_band');
    expect(codes(priced({ delta: -0.25 }))).not.toContain('delta_outside_band');
  });
  it('CC uses the CC band', () => {
    const c = contract({ strategy: 'CC', right: 'C' });
    expect(codes(priced({ delta: 0.3 }, c), 'CC')).not.toContain('delta_outside_band');
    expect(codes(priced({ delta: 0.15 }, c), 'CC')).toContain('delta_outside_band');
  });
  it('missing delta gives no delta flag', () => {
    expect(codes(priced({ delta: null }))).not.toContain('delta_outside_band');
  });
  it('CSP spread uses the relative policy', () => {
    expect(codes(priced({ bid: 5.4, ask: 5.6 }))).not.toContain('wide_spread');
    const f = flagRow(priced({ bid: 4.9, ask: 5.6 }), 'CSP', defaultFlagRules('CSP'), null).filter((x) => x.code === 'wide_spread');
    expect(f).toHaveLength(1);
    expect(f[0].label).toMatch(/borderline/);
    expect(flagRow(priced({ bid: 4, ask: 5.6 }), 'CSP', defaultFlagRules('CSP'), null).filter((x) => x.code === 'wide_spread')[0].label).toMatch(/poor/);
  });
  it('CC spread uses the hybrid rule and ceiling', () => {
    const c = contract({ strategy: 'CC', right: 'C' });
    expect(codes(priced({ bid: 0.38, ask: 0.4 }, c), 'CC')).not.toContain('wide_spread');
    expect(codes(priced({ bid: 0.3, ask: 0.4 }, c), 'CC')).toContain('wide_spread');
    expect(codes(priced({ bid: 4.9, ask: 5.5 }, c), 'CC')).toContain('wide_spread'); // over the $0.50 ceiling
  });
  it('thin OI flags below the minimum only; null OI is not flagged', () => {
    expect(codes(priced({ openInterest: 499 }))).toContain('thin_oi');
    expect(codes(priced({ openInterest: 500 }))).not.toContain('thin_oi');
    expect(codes(priced({ openInterest: null }))).not.toContain('thin_oi');
    const c = contract({ strategy: 'CC', right: 'C' });
    expect(codes(priced({ openInterest: 99 }, c), 'CC')).toContain('thin_oi');
    expect(codes(priced({ openInterest: 100 }, c), 'CC')).not.toContain('thin_oi');
  });
  it('no-quote rows get no spread flag but keep OI and no delta flag', () => {
    const r = priced({ bid: 0, ask: 0, openInterest: 5 });
    expect(codes(r)).toEqual(['thin_oi']);
  });
  it('below cost basis is covered calls only, strict, and needs a basis', () => {
    const c = contract({ strategy: 'CC', right: 'C', strike: 16 });
    const r = priced({}, c);
    expect(codes(r, 'CC', 17)).toContain('below_cost_basis');
    expect(codes(r, 'CC', 16)).not.toContain('below_cost_basis');
    expect(codes(r, 'CC', null)).not.toContain('below_cost_basis');
    expect(codes(priced({}), 'CSP', 500)).not.toContain('below_cost_basis');
  });
  it('there is no DTE flag at any DTE', () => {
    const r = buildLookup({
      contract: contract(), expiration: '2026-10-16', nextExpiration: null, contracts: 1,
      rows: [row(120, { expiration: '2026-10-16', delta: -0.2 })], underlyingPrice: 135, classification: 'etf', today, coverage: cov,
    });
    expect(applyFlags(r).pick!.flags).toEqual([]);
  });
});

describe('applyFlags', () => {
  it('flags every row, keeps the pick in sync, and leaves the input untouched', () => {
    const r = buildLookup({
      contract: contract(), expiration: '2026-11-06', nextExpiration: null, contracts: 1,
      rows: [row(115, { openInterest: 5 }), row(120)], underlyingPrice: 135, classification: 'etf', today, coverage: cov,
    });
    const out = applyFlags(r);
    expect(out.rows[0].flags.map((f) => f.code)).toContain('thin_oi');
    expect(out.pick).toBe(out.rows.filter((x) => x.isPick)[0]);
    expect(out.pick!.flags.map((f) => f.code)).toContain('delta_outside_band');
    expect(r.rows[0].flags).toEqual([]);
  });
  it('accepts live scan rules', () => {
    const r = buildLookup({
      contract: contract(), expiration: '2026-11-06', nextExpiration: null, contracts: 1,
      rows: [row(120, { delta: -0.3 })], underlyingPrice: 135, classification: 'etf', today, coverage: cov,
    });
    const rules = Object.assign({}, defaultFlagRules('CSP'), { deltaMax: 0.35 });
    expect(applyFlags(r, rules).pick!.flags.map((f) => f.code)).not.toContain('delta_outside_band');
  });
  it('passes strike_not_listed results through with no rows', () => {
    const r = buildLookup({
      contract: contract({ strike: 121 }), expiration: '2026-11-06', nextExpiration: null, contracts: 1,
      rows: [row(120)], underlyingPrice: 135, classification: 'etf', today, coverage: cov,
    });
    const out = applyFlags(r);
    expect(out.status).toBe('strike_not_listed');
    expect(out.pick).toBeNull();
  });
});
