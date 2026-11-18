// lib/__tests__/optimize.test.ts
//
// OPTMAP-0001 S5 (Alan, Quinn): Optimize must return exactly what the screener's own finders return for the same
// legs, because it only maps quotes into the screener's format.

import { describe, it, expect } from 'vitest';
import { runOptimize, toScreenerLegs, candidateToMap } from '@/lib/trademap/optimize';
import { DEFAULT_RULES } from '@/lib/scans/constants';
import { findBestSpread, trySpreadAtWidth } from '@/lib/scans/spread-finder';
import { bsGreeks, } from '@/lib/trademap/greeks';
import { bsPrice, utcMsToIso } from '@/lib/trademap/pricing';
import type { ChainExpiration, OptionQuote } from '@/lib/trademap/chain';

const SPOT = 732.44, IV = 0.3, DTE = 31;
// A calm synthetic chain cannot meet the real 0.33 credit-ratio rule, so parity runs on relaxed rules; the point is that
// Optimize and the screener's finders agree for the same rules and legs.
const RULES = { ...DEFAULT_RULES, CREDIT_RATIO_MIN: 0.1, ROC_MIN_SPREAD: 5 };
const date = utcMsToIso(Date.now() + DTE * 86_400_000);

function build(right: 'P' | 'C', opts: { dropQuote?: number } = {}) {
  const strikes: ChainExpiration['strikes'] = [];
  const quotes: Record<string, OptionQuote> = {};
  for (let k = 640; k <= 830; k += 1) {
    const sym = `SPY${date.replace(/-/g, '')}${right}${String(k * 1000).padStart(8, '0')}`;
    strikes.push({ strike: k, call: right === 'C' ? sym : null, put: right === 'P' ? sym : null });
    if (opts.dropQuote === k) continue;
    const t = DTE / 365;
    const mid = bsPrice(right, SPOT, k, t, 0.04, 0, IV)!;
    const g = bsGreeks(right, SPOT, k, t, 0.04, 0, IV)!;
    quotes[sym] = { symbol: sym, bid: Math.max(0.01, +(mid - 0.03).toFixed(2)), ask: +(mid + 0.03).toFixed(2), mid: +mid.toFixed(2), iv: IV, delta: g.delta, openInterest: 1500, updatedAtMs: Date.now(), halted: false };
  }
  const exp: ChainExpiration = { date, dte: DTE, strikes };
  return { exp, quotes };
}

describe('Optimize = the screener\'s own pick', () => {
  const { exp, quotes } = build('P');
  const base = { strategy: 'bps' as const, exp, quotes, price: SPOT, expirationIv: IV, rules: RULES };

  it('at the trader\'s width it equals trySpreadAtWidth on the same legs', () => {
    const r = runOptimize({ ...base, widthDollars: 10 });
    const legs = toScreenerLegs(exp, quotes, 'bps');
    const direct = trySpreadAtWidth(legs, 'BPS', date, 10, SPOT, RULES, IV);
    expect(r.pick).toEqual(direct);
    expect(r.pick).not.toBeNull();
    expect(r.pick!.longStrike).toBe(r.pick!.shortStrike - 10);
    expect(r.pick!.shortDelta).toBeGreaterThanOrEqual(RULES.SPREAD_DELTA_MIN);
    expect(r.pick!.shortDelta).toBeLessThanOrEqual(RULES.SPREAD_DELTA_MAX);
  });
  it('with no width set it equals findBestSpread, and heads the per-width list', () => {
    const r = runOptimize({ ...base, widthDollars: null });
    const legs = toScreenerLegs(exp, quotes, 'bps');
    expect(r.pick).toEqual(findBestSpread(legs, 'BPS', date, SPOT, RULES, IV));
    expect(r.atEachWidth[0]).toEqual(r.pick);
    expect(r.atEachWidth.length).toBeGreaterThan(1);
  });
  it('returns no pick (not a weak one) when nothing meets the saved criteria', () => {
    const r = runOptimize({ ...base, widthDollars: 10, rules: { ...RULES, CREDIT_RATIO_MIN: 0.99 } });
    expect(r.pick).toBeNull();
    expect(r.noQuotes).toBe(false);
  });
  it('says there are no quotes when no strike has a complete quote', () => {
    expect(runOptimize({ ...base, quotes: {}, widthDollars: 10 })).toEqual({ pick: null, atEachWidth: [], noQuotes: true });
  });
  it('leaves out a strike whose quote is missing or incomplete', () => {
    const b = build('P', { dropQuote: 700 });
    expect(toScreenerLegs(b.exp, b.quotes, 'bps').some(l => l.strikePrice === 700)).toBe(false);
    const sym = b.exp.strikes.find(s => s.strike === 701)!.put!;
    b.quotes[sym] = { ...b.quotes[sym], bid: null };
    expect(toScreenerLegs(b.exp, b.quotes, 'bps').some(l => l.strikePrice === 701)).toBe(false);
  });
  it('maps a candidate to the map\'s anchor and width in listed strikes', () => {
    const r = runOptimize({ ...base, widthDollars: 10 });
    expect(candidateToMap(r.pick!, exp)).toEqual({ anchor: r.pick!.shortStrike, widthSteps: 10 });
  });
  it('bear call spread uses the call side', () => {
    const c = build('C');
    const r = runOptimize({ strategy: 'bcs', exp: c.exp, quotes: c.quotes, price: SPOT, expirationIv: IV, rules: RULES, widthDollars: 10 });
    if (r.pick) expect(r.pick.longStrike).toBe(r.pick.shortStrike + 10);
    expect(toScreenerLegs(c.exp, c.quotes, 'bcs').every(l => l.optionType === 'C')).toBe(true);
  });
});
