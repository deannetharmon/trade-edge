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

/** Best cell to describe by default: in-goal cells first, then by total if called away (highest), unknown last. */
export function pickDefaultAnchor(cells: CcGridCell[], goal: CcGoal): CcGridCell | null {
  if (cells.length === 0) return null;
  const score = (c: CcGridCell) => (c.calledAwayTotal === null ? -Infinity : c.calledAwayTotal);
  const pool = cells.some(c => cellInGoal(c, goal)) ? cells.filter(c => cellInGoal(c, goal)) : cells;
  return pool.reduce((best, c) => (score(c) > score(best) ? c : best), pool[0]);
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
  const per = grid.contracts === 1 ? 'one call' : `${grid.contracts} calls`;
  const head = `Sell ${per}${symbol ? ' on ' + symbol : ''} expiring in ${cell.dte} days at the $${cell.strike} strike and collect ${usd(cell.premiumTotal)}.`;
  if (cell.calledAwayTotal === null) return head;
  const total = cell.calledAwayTotal;
  const tail = total >= 0
    ? ` If the shares are called away you make ${usd(total)} in total on your cost.`
    : ` If the shares are called away you lose ${usd(total)} in total against your cost: this strike is below it.`;
  return head + tail;
}
