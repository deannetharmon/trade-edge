// lib/scans/ccGridView.ts
// CC-WHEEL-0001 S4 (grid v2) -- what the strike grid shows. Pure.
// Goals reuse the existing delta presets (ccRegistry): Upside .10-.20, Balanced .20-.35, Income .30-.40.
// The grid is a small window: the first few expirations and a handful of strikes around the selected trade.

import type { CcGrid, CcGridCell } from './ccGridTypes';

export type CcGoal = 'upside' | 'balanced' | 'income';

export const CC_GOALS: Record<CcGoal, { label: string; min: number; max: number }> = {
  upside: { label: 'Keep more upside', min: 0.10, max: 0.20 },
  balanced: { label: 'Balanced', min: 0.20, max: 0.35 },
  income: { label: 'More income', min: 0.30, max: 0.40 },
};

export const DEFAULT_CC_GOAL: CcGoal = 'balanced';
/** Expirations shown before "more expirations", and strikes shown on each side of the selected one. */
export const CC_GRID_DEFAULT_EXPIRATIONS = 4;
export const CC_GRID_STRIKES_EACH_SIDE = 2;

export function cellInGoal(cell: Pick<CcGridCell, 'delta'>, goal: CcGoal): boolean {
  const g = CC_GOALS[goal];
  return cell.delta >= g.min && cell.delta <= g.max;
}

export interface CcGridWindowOptions {
  showBelowFloor: boolean;
  /** Show every expiration instead of the first few. */
  allExpirations: boolean;
  /** The selected cell, when the user clicked one. Otherwise the best cell for the goal is used. */
  selected: { expiration: string; strike: number } | null;
  extraAbove: number;
  extraBelow: number;
}

export interface CcGridWindow {
  expirations: Array<{ expiration: string; dte: number }>;
  /** Strikes to show, highest first. */
  strikes: number[];
  cell: (expiration: string, strike: number) => CcGridCell | undefined;
  /** The cell the summary describes. */
  anchor: CcGridCell | null;
  hiddenBelowFloor: number;
  moreExpirations: number;
  moreStrikesAbove: number;
  moreStrikesBelow: number;
  /** True when at least one visible cell is in the goal's delta range. */
  anyInGoal: boolean;
}

/**
 * The numbers a cell shows. A wide bid/ask spread makes the midpoint unreliable, so a wide cell uses the BID (what you can
 * count on being paid); the midpoint stays in the cell data for the hover text and the order dialog's starting limit.
 */
export function ccCellNumbers(grid: CcGrid, cell: CcGridCell) {
  const usedBid = cell.wide;
  const perShare = usedBid ? Math.round(cell.bid * 100) / 100 : cell.premiumPerShare;
  const premiumTotal = Math.round(perShare * 100 * grid.contracts * 100) / 100;
  const basis = grid.basis;
  const calledAwayTotal = basis === null ? null : Math.round(((cell.strike - basis) * 100 * grid.contracts + premiumTotal) * 100) / 100;
  return {
    usedBid,
    premiumPerShare: perShare,
    premiumTotal,
    calledAwayTotal,
    calledAwayPct: calledAwayTotal === null || basis === null ? null : Math.round((calledAwayTotal / (basis * 100 * grid.contracts)) * 10000) / 100,
    notCalledBasis: basis === null ? null : Math.round((basis - perShare) * 100) / 100,
  };
}

/** How far the stock must rise from today's price for this strike to be reached; null when the price is unknown. */
export function ccStockMovePct(grid: CcGrid, cell: Pick<CcGridCell, 'strike'>): number | null {
  return typeof grid.stockPrice === 'number' && grid.stockPrice > 0 ? Math.round((cell.strike / grid.stockPrice - 1) * 1000) / 10 : null;
}

/** The market's estimate of the chance this call finishes in the money, as a whole percent. An estimate, not a guarantee. */
export function ccChanceCalledPct(cell: Pick<CcGridCell, 'delta'>): number {
  return Math.round(cell.delta * 100);
}

/**
 * Best cell to describe by default: cells in the goal's delta range first (else all), then the ones with a tight spread,
 * then the one closest to the middle of the goal's delta range, then the larger premium. The biggest total if called away
 * is NOT used: it always points at the strike furthest from the price.
 */
export function pickDefaultAnchor(cells: CcGridCell[], goal: CcGoal): CcGridCell | null {
  if (cells.length === 0) return null;
  const g = CC_GOALS[goal];
  const center = (g.min + g.max) / 2;
  const pool = cells.some(c => cellInGoal(c, goal)) ? cells.filter(c => cellInGoal(c, goal)) : cells;
  const better = (a: CcGridCell, b: CcGridCell) => {
    if (a.wide !== b.wide) return !a.wide;
    const da = Math.abs(a.delta - center);
    const db = Math.abs(b.delta - center);
    if (da !== db) return da < db;
    return a.premiumPerShare > b.premiumPerShare;
  };
  return pool.reduce((best, c) => (better(c, best) ? c : best), pool[0]);
}

export function selectCcGridWindow(grid: CcGrid, goal: CcGoal, opts: CcGridWindowOptions): CcGridWindow {
  const hiddenBelowFloor = opts.showBelowFloor ? 0 : grid.cells.filter(c => c.belowFloor).length;
  const visible = grid.cells.filter(c => opts.showBelowFloor || !c.belowFloor);
  const shownExpirations = grid.expirations.filter(e => visible.some(c => c.expiration === e.expiration));
  // The selected trade's expiration is always shown, even when it is past the first few.
  const expirations = opts.allExpirations
    ? shownExpirations
    : shownExpirations.filter((e, i) => i < CC_GRID_DEFAULT_EXPIRATIONS || e.expiration === opts.selected?.expiration);
  const moreExpirations = shownExpirations.length - expirations.length;
  const inShown = visible.filter(c => expirations.some(e => e.expiration === c.expiration));
  const byKey = new Map(inShown.map(c => [`${c.expiration}|${c.strike}`, c] as const));

  const selectedCell = opts.selected ? byKey.get(`${opts.selected.expiration}|${opts.selected.strike}`) ?? null : null;
  const anchor = selectedCell ?? pickDefaultAnchor(inShown, goal);

  const allStrikes = Array.from(new Set(inShown.map(c => c.strike))).sort((a, b) => a - b);
  let strikes: number[] = [];
  let moreStrikesAbove = 0;
  let moreStrikesBelow = 0;
  if (anchor) {
    const at = allStrikes.indexOf(anchor.strike);
    const lo = Math.max(0, at - CC_GRID_STRIKES_EACH_SIDE - Math.max(0, opts.extraBelow));
    const hi = Math.min(allStrikes.length - 1, at + CC_GRID_STRIKES_EACH_SIDE + Math.max(0, opts.extraAbove));
    strikes = allStrikes.slice(lo, hi + 1).reverse();
    moreStrikesBelow = lo;
    moreStrikesAbove = allStrikes.length - 1 - hi;
  }
  return {
    expirations, strikes, cell: (e, k) => byKey.get(`${e}|${k}`), anchor, hiddenBelowFloor,
    moreExpirations, moreStrikesAbove, moreStrikesBelow, anyInGoal: inShown.some(c => cellInGoal(c, goal)),
  };
}

const usd = (n: number) => '$' + Math.abs(n).toLocaleString('en-US', { maximumFractionDigits: 0 });

/** One plain sentence for the selected trade. */
export function ccGridSummary(grid: CcGrid, cell: CcGridCell, symbol?: string): string {
  const n = ccCellNumbers(grid, cell);
  const per = grid.contracts === 1 ? 'one call' : `${grid.contracts} calls`;
  const head = `Sell ${per}${symbol ? ' on ' + symbol : ''} expiring in ${cell.dte} days at the $${cell.strike} strike and collect ${usd(n.premiumTotal)}${n.usedBid ? ' (at the bid: the spread is wide)' : ''}.`;
  if (n.calledAwayTotal === null) return head;
  const move = ccStockMovePct(grid, cell);
  const needs = move !== null && move > 0 ? ` and ${symbol ?? 'the stock'} would have to rise ${move.toFixed(0)}% to get there` : '';
  const total = n.calledAwayTotal;
  const tail = total >= 0
    ? ` If the shares are called away${needs} you make ${usd(total)} in total against your cost.`
    : ` If the shares are called away you lose ${usd(total)} in total against your cost: this strike is below it.`;
  return head + tail;
}

export interface CcSellPricePick {
  cell: CcGridCell | null;
  /** Plain-language note when the pick is not exactly what was typed. */
  note: string | null;
}

/**
 * "I would be happy to sell my shares at $X": the call to sell. Within one expiration (the one the trader is looking at)
 * it takes the lowest strike at or above X, which keeps the most premium for a price the trader accepts. A strike below
 * the cost basis is never offered unless the grid is allowed to show it. Pure.
 */
export function pickCellForSellPrice(
  grid: CcGrid,
  sellPrice: number,
  opts: { expiration: string; allowBelowFloor: boolean },
): CcSellPricePick {
  if (!Number.isFinite(sellPrice) || sellPrice <= 0) return { cell: null, note: 'Enter a price above 0.' };
  const pool = grid.cells
    .filter(c => c.expiration === opts.expiration && (opts.allowBelowFloor || !c.belowFloor))
    .sort((a, b) => a.strike - b.strike);
  if (pool.length === 0) return { cell: null, note: 'No strikes are available for this expiration.' };
  const atOrAbove = pool.find(c => c.strike >= sellPrice);
  if (atOrAbove) {
    return atOrAbove.strike === sellPrice
      ? { cell: atOrAbove, note: null }
      : { cell: atOrAbove, note: `No $${sellPrice} strike. The closest at or above it is $${atOrAbove.strike}.` };
  }
  const highest = pool[pool.length - 1];
  return { cell: highest, note: `No strike reaches $${sellPrice} in this expiration. The highest is $${highest.strike}.` };
}
