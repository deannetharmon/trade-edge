// lib/scans/__tests__/ccGrid.test.ts
// CC-WHEEL-0001 S4 -- grid cell math, safety exclusions, goal highlighting and the below-floor switch.
import { describe, it, expect } from 'vitest';
import { buildCcGrid } from '../covered-call-finder';
import { computeCoveredCallCapacity } from '../covered-call-capacity';
import { selectCcGridWindow, cellInGoal, ccGridSummary, ccCellNumbers, ccStockMovePct, ccChanceCalledPct, pickDefaultAnchor, pickCellForSellPrice, pickQuickCell, filterCcGrid, sanitizeCcMinPay } from '../ccGridView';
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
    const cell = { ...grid.cells.find(c => c.strike === 80 && c.dte >= 29)!, wide: false };
    const t = ccGridSummary(grid, cell);
    expect(t).toContain('you lose $180');
    expect(t).toContain('below it');
  });
});

describe('ccCellNumbers: wide cells use the bid', () => {
  it('tight cell uses the mid; wide cell uses the bid and its totals follow', () => {
    const tight = { ...grid.cells.find(c => c.strike === 80 && c.dte >= 29)!, wide: false }; // mid 1.10
    expect(ccCellNumbers(grid, tight).premiumTotal).toBe(220);
    const wideCell = { ...grid.cells.find(c => c.strike === 95)!, bid: 0.1, ask: 0.9, premiumPerShare: 0.5, wide: true };
    const n = ccCellNumbers(grid, wideCell);
    expect(n.usedBid).toBe(true);
    expect(n.premiumTotal).toBe(20);          // 0.10 x 100 x 2 contracts
    expect(n.calledAwayTotal).toBe(2620);     // (95-82)*200 + 20
    expect(n.notCalledBasis).toBe(81.9);
  });
  it('how far the stock must rise, and the chance of being called', () => {
    expect(ccStockMovePct(grid, { strike: 85 })).toBe(35.2); // 85 / 62.85
    expect(ccChanceCalledPct({ delta: 0.024 })).toBe(2);
  });
});

describe('pickDefaultAnchor does not chase the biggest total if called', () => {
  const mk = (strike: number, delta: number, wide = false) => ({ ...grid.cells[0], strike, delta, wide, premiumPerShare: 0.3, calledAwayTotal: (strike - 82) * 100 });
  it('prefers the tight call closest to the goal, not the furthest strike', () => {
    const cells = [mk(105, 0.02), mk(100, 0.03), mk(86, 0.07), mk(84, 0.12)];
    expect(pickDefaultAnchor(cells, 'income')?.strike).toBe(84); // none in range: closest delta to .35 wins
  });
  it('a tight call beats a wide one in range', () => {
    const cells = [mk(90, 0.25, true), mk(92, 0.22, false)];
    expect(pickDefaultAnchor(cells, 'balanced')?.strike).toBe(92);
  });
});

describe('pickCellForSellPrice', () => {
  const mk = (strike: number, belowFloor = false) => ({ expiration: 'E', dte: 10, strike, delta: 0.2, bid: 1, ask: 1.1, premiumPerShare: 1, openInterest: 500, occSymbol: 'C' + strike, belowFloor, wide: false, thinOi: false, calledAwayTotal: 0, calledAwayPct: 0, premiumTotal: 100, notCalledBasis: 80 });
  const g = { basis: 80, floor: 80, stockPrice: 70, contracts: 1, expirations: [{ expiration: 'E', dte: 10 }], cells: [mk(75, true), mk(82), mk(85), mk(90)], left: { inTheMoney: 0, unusableQuote: 0, earnings: 0, farOtm: 0, truncated: 0 } };
  it('takes the exact strike when there is one', () => {
    expect(pickCellForSellPrice(g, 85, { expiration: 'E', allowBelowFloor: false })).toMatchObject({ cell: { strike: 85 }, note: null });
  });
  it('takes the lowest strike at or above the price', () => {
    expect(pickCellForSellPrice(g, 83, { expiration: 'E', allowBelowFloor: false }).cell?.strike).toBe(85);
  });
  it('never offers a below-basis strike unless allowed', () => {
    expect(pickCellForSellPrice(g, 70, { expiration: 'E', allowBelowFloor: false }).cell?.strike).toBe(82);
    expect(pickCellForSellPrice(g, 70, { expiration: 'E', allowBelowFloor: true }).cell?.strike).toBe(75);
  });
  it('falls back to the highest strike and says so', () => {
    const r = pickCellForSellPrice(g, 100, { expiration: 'E', allowBelowFloor: false });
    expect(r.cell?.strike).toBe(90);
    expect(r.note).toContain('highest is $90');
  });
  it('rejects a bad price', () => {
    expect(pickCellForSellPrice(g, Number.NaN, { expiration: 'E', allowBelowFloor: false }).cell).toBeNull();
  });
});

import { ccAdvisorFacts } from '../advisorCards';
describe('ccAdvisorFacts', () => {
  it('says a strike above the basis is above it, with the gain, and notes the stock is under the basis', () => {
    const f = ccAdvisorFacts({ strike: 85, underlyingPrice: 61.48, costBasis: 82 });
    expect(f[0]).toContain('ABOVE the current stock price');
    expect(f[1]).toContain('3.7% ABOVE the cost basis');
    expect(f[1]).toContain('gain of $3.00');
    expect(f[2]).toContain('BELOW the cost basis');
  });
  it('says a strike under the basis is a loss', () => {
    expect(ccAdvisorFacts({ strike: 80, underlyingPrice: 90, costBasis: 82 }).join(' ')).toContain('loss of $2.00');
  });
  it('says an in-the-money strike is in the money and skips unknowns', () => {
    expect(ccAdvisorFacts({ strike: 60, underlyingPrice: 61, costBasis: null })).toEqual([expect.stringContaining('in the money')]);
  });
});

describe('pickQuickCell', () => {
  const mk = (strike: number, delta: number, premiumPerShare: number, over: Record<string, unknown> = {}) => ({ expiration: 'E', dte: 10, strike, delta, bid: premiumPerShare, ask: premiumPerShare, premiumPerShare, openInterest: 500, occSymbol: 'C' + strike, belowFloor: false, wide: false, thinOi: false, calledAwayTotal: 0, calledAwayPct: 0, premiumTotal: 0, notCalledBasis: 80, ...over });
  const g = { basis: 80, floor: 80, stockPrice: 70, contracts: 1, expirations: [{ expiration: 'E', dte: 10 }], left: { inTheMoney: 0, unusableQuote: 0, earnings: 0, farOtm: 0, truncated: 0 },
    cells: [mk(82, 0.30, 1.0), mk(85, 0.10, 0.40), mk(90, 0.03, 0.05), mk(95, 0.02, 3.0, { wide: true, bid: 0.1 })] };
  it('most paid now ignores wide cells', () => {
    expect(pickQuickCell(g, 'paid', { allowBelowFloor: false })?.strike).toBe(82);
  });
  it('most if called is the highest total against the basis', () => {
    expect(pickQuickCell(g, 'called', { allowBelowFloor: false })?.strike).toBe(90);
  });
  it('least likely called skips calls that pay almost nothing', () => {
    expect(pickQuickCell(g, 'safe', { allowBelowFloor: false })?.strike).toBe(85);
  });
  it('returns null when nothing qualifies', () => {
    expect(pickQuickCell({ ...g, cells: [mk(95, 0.02, 3.0, { wide: true })] }, 'paid', { allowBelowFloor: false })).toBeNull();
  });
});

describe('filterCcGrid', () => {
  const mk = (strike: number, premiumPerShare: number, over: Record<string, unknown> = {}) => ({ expiration: 'E', dte: 10, strike, delta: 0.2, bid: premiumPerShare, ask: premiumPerShare, premiumPerShare, openInterest: 500, occSymbol: 'C' + strike, belowFloor: false, wide: false, thinOi: false, calledAwayTotal: 0, calledAwayPct: 0, premiumTotal: 0, notCalledBasis: 80, ...over });
  const g = { basis: 80, floor: 80, stockPrice: 70, contracts: 1, expirations: [{ expiration: 'E', dte: 10 }], left: { inTheMoney: 0, unusableQuote: 0, earnings: 0, farOtm: 0, truncated: 0 },
    cells: [mk(82, 0.5), mk(84, 0.02), mk(85, 0.4, { thinOi: true }), mk(86, 0.02, { thinOi: true })] };
  it('hides thin open interest first and low pay second, counting each call once', () => {
    const r = filterCcGrid(g, { minPay: 25 });
    expect(r.grid.cells.map(c => c.strike)).toEqual([82]);
    expect(r.hiddenThinOi).toBe(2);
    expect(r.hiddenLowPay).toBe(1);
  });
  it('Any keeps low-paying calls but still hides thin open interest', () => {
    const r = filterCcGrid(g, { minPay: 0 });
    expect(r.grid.cells.map(c => c.strike)).toEqual([82, 84]);
    expect(r.hiddenLowPay).toBe(0);
  });
  it('sanitizes the stored minimum', () => {
    expect(sanitizeCcMinPay('50')).toBe(50);
    expect(sanitizeCcMinPay('7')).toBe(25);
    expect(sanitizeCcMinPay(null)).toBe(25);
  });
});
