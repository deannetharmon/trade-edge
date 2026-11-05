// lib/scans/__tests__/ccGrid.test.ts
// CC-WHEEL-0001 S4 -- grid cell math, safety exclusions, goal highlighting and the below-floor switch.
import { describe, it, expect } from 'vitest';
import { buildCcGrid } from '../covered-call-finder';
import { computeCoveredCallCapacity } from '../covered-call-capacity';
import { selectCcGridWindow, cellInGoal, ccGridSummary } from '../ccGridView';
import type { CcRulesType } from '../constants';
import type { WheelChainLeg } from '@/lib/wheel/chainSearch';

const RULES: CcRulesType = { DELTA_MIN: 0.10, DELTA_MAX: 0.60, DTE_MIN: 7, DTE_MAX: 60, OI_MIN: 100, WIDTH_PCT_MAX: 10, WIDTH_CEILING: 0.50 };

function expIn(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}
function leg(exp: string, strike: number, delta: number, bid: number, ask: number, oi = 500): WheelChainLeg {
  return { strikePrice: strike, expirationDate: exp, optionType: 'C', delta, openInterest: oi, bid, ask, mid: (bid + ask) / 2, occSymbol: `C${strike}` } as unknown as WheelChainLeg;
}

const E1 = expIn(10);
const E2 = expIn(30);
const E3 = expIn(120); // outside DTE
const chain = {
  expirations: [E1, E2, E3],
  chains: {
    [E1]: [leg(E1, 60, 0.6, 3, 3.1), leg(E1, 65, 0.15, 0.4, 0.5), leg(E1, 80, 0.12, 0.28, 0.32), leg(E1, 85, 0.01, 0.1, 0.12)],
    [E2]: [leg(E2, 80, 0.25, 1.0, 1.2), leg(E2, 90, 0.3, 0, 0.5), leg(E2, 95, 0.2, 0.1, 0.9, 5)],
    [E3]: [leg(E3, 90, 0.2, 1, 1.05)],
  },
};
const capacity = computeCoveredCallCapacity(200, 0, 0, 82); // 2 contracts
const grid = buildCcGrid(chain, { rules: RULES, capacity, stockPrice: 62.85 });

describe('buildCcGrid', () => {
  it('uses the DTE window, and counts what it leaves out', () => {
    expect(grid.expirations.map(e => e.expiration)).toEqual([E1, E2]);
    expect(grid.left.inTheMoney).toBe(1);   // $60 < price
    expect(grid.left.farOtm).toBe(1);       // delta .01
    expect(grid.left.unusableQuote).toBe(1); // bid 0
  });
  it('floor is the higher of price and basis; below-basis strikes are flagged, not removed', () => {
    expect(grid.floor).toBe(82);
    expect(grid.cells.find(c => c.strike === 65)?.belowFloor).toBe(true);
    expect(grid.cells.find(c => c.strike === 80)?.belowFloor).toBe(true);
    expect(grid.cells.find(c => c.strike === 95)?.belowFloor).toBe(false);
  });
  it('called-away and not-called math at an $82 basis, 2 contracts', () => {
    const c = grid.cells.find(x => x.strike === 80 && x.dte >= 29)!; // mid 1.10
    expect(c.premiumPerShare).toBe(1.1);
    expect(c.premiumTotal).toBe(220);
    expect(c.calledAwayTotal).toBe(-180); // (80-82)*200 + 220
    expect(c.notCalledBasis).toBe(80.9);
  });
  it('tags wide and thin-OI cells instead of dropping them', () => {
    const c = grid.cells.find(x => x.strike === 95)!;
    expect(c.wide).toBe(true);
    expect(c.thinOi).toBe(true);
  });
  it('fails closed with no basis and no price', () => {
    const none = buildCcGrid(chain, { rules: RULES, capacity: computeCoveredCallCapacity(200, 0, 0, null), stockPrice: null as unknown as number });
    expect(none.cells).toEqual([]);
    expect(none.floor).toBeNull();
  });
});

const base = { showBelowFloor: false, allExpirations: false, selected: null, extraAbove: 0, extraBelow: 0 };

describe('selectCcGridWindow', () => {
  it('hides below-basis strikes by default and counts them', () => {
    const v = selectCcGridWindow(grid, 'balanced', base);
    expect(v.strikes).toEqual([95]);
    expect(v.hiddenBelowFloor).toBe(3);
    expect(v.anchor?.strike).toBe(95);
  });
  it('shows them when switched on, highest strike first', () => {
    const v = selectCcGridWindow(grid, 'balanced', { ...base, showBelowFloor: true });
    expect(v.strikes).toEqual([95, 80, 65]);
    expect(v.hiddenBelowFloor).toBe(0);
  });
  it('the goal picks the starting trade: in-goal cells first, then the best total if called', () => {
    const v = selectCcGridWindow(grid, 'upside', { ...base, showBelowFloor: true });
    expect(v.anchor && cellInGoal(v.anchor, 'upside')).toBe(true);
  });
  it('a click selects the trade the summary describes', () => {
    const v = selectCcGridWindow(grid, 'balanced', { ...base, showBelowFloor: true, selected: { expiration: E2, strike: 80 } });
    expect(v.anchor?.strike).toBe(80);
    expect(v.anchor?.expiration).toBe(E2);
  });
  it('anyInGoal is false when no cell matches the goal', () => {
    expect(selectCcGridWindow(grid, 'income', base).anyInGoal).toBe(false);
  });
  it('limits the strike window around the trade and offers more', () => {
    const wide = { ...grid, cells: [60, 61, 62, 63, 64, 65, 66, 67, 68, 69].map(k => ({ ...grid.cells[0], strike: k, belowFloor: false, expiration: E1, dte: 10 })), expirations: [{ expiration: E1, dte: 10 }] };
    const v = selectCcGridWindow(wide, 'balanced', { ...base, selected: { expiration: E1, strike: 64 } });
    expect(v.strikes).toEqual([66, 65, 64, 63, 62]);
    expect(v.moreStrikesAbove).toBe(3);
    expect(v.moreStrikesBelow).toBe(2);
    const more = selectCcGridWindow(wide, 'balanced', { ...base, selected: { expiration: E1, strike: 64 }, extraAbove: 1, extraBelow: 1 });
    expect(more.strikes).toEqual([67, 66, 65, 64, 63, 62, 61]);
  });
  it('shows the first four expirations, then the rest on request', () => {
    const exps = [5, 6, 7, 8, 9, 10].map(d => ({ expiration: `2030-01-0${d - 4}`, dte: d }));
    const many = { ...grid, expirations: exps, cells: exps.map(e => ({ ...grid.cells[0], expiration: e.expiration, dte: e.dte, strike: 90, belowFloor: false })) };
    const v = selectCcGridWindow(many, 'balanced', base);
    expect(v.expirations).toHaveLength(4);
    expect(v.moreExpirations).toBe(2);
    expect(selectCcGridWindow(many, 'balanced', { ...base, allExpirations: true }).expirations).toHaveLength(6);
    // the selected trade's expiration stays visible even when it is past the first four
    const sel = selectCcGridWindow(many, 'balanced', { ...base, selected: { expiration: exps[5].expiration, strike: 90 } });
    expect(sel.expirations.map(e => e.expiration)).toContain(exps[5].expiration);
    expect(sel.anchor?.expiration).toBe(exps[5].expiration);
  });
});

describe('ccGridSummary', () => {
  it('describes a trade above the basis', () => {
    const cell = grid.cells.find(c => c.strike === 95)!;
    const t = ccGridSummary(grid, cell, 'TQQQ');
    expect(t).toContain('Sell 2 calls on TQQQ');
    expect(t).toContain('$95 strike');
    expect(t).toMatch(/you make \$/);
  });
  it('says plainly when a trade is below the basis', () => {
    const cell = grid.cells.find(c => c.strike === 80 && c.dte >= 29)!;
    const t = ccGridSummary(grid, cell);
    expect(t).toContain('you lose $180');
    expect(t).toContain('below it');
  });
});
