// lib/scans/ccGridView.ts
// CC-WHEEL-0001 S4 -- what the strike grid shows for a goal. Pure.
// Goals reuse the existing delta presets (ccRegistry): Upside .10-.20, Balanced .20-.35, Income .30-.40.

import type { CcGrid, CcGridCell } from './ccGridTypes';

export type CcGoal = 'upside' | 'balanced' | 'income';

export const CC_GOALS: Record<CcGoal, { label: string; min: number; max: number }> = {
  upside: { label: 'Keep more upside', min: 0.10, max: 0.20 },
  balanced: { label: 'Balanced', min: 0.20, max: 0.35 },
  income: { label: 'More income', min: 0.30, max: 0.40 },
};

export const DEFAULT_CC_GOAL: CcGoal = 'balanced';

export function cellInGoal(cell: Pick<CcGridCell, 'delta'>, goal: CcGoal): boolean {
  const g = CC_GOALS[goal];
  return cell.delta >= g.min && cell.delta <= g.max;
}

export interface CcGridView {
  expirations: Array<{ expiration: string; dte: number }>;
  strikes: number[];
  cell: (expiration: string, strike: number) => CcGridCell | undefined;
  /** Cells that are hidden only because of the "below cost basis" switch. */
  hiddenBelowFloor: number;
  /** True when the strike rows were narrowed to the goal range; false when no cell was in range, so every strike shows. */
  narrowedToGoal: boolean;
}

/**
 * Rows and columns for the grid. Strikes below the cost basis are hidden unless `showBelowFloor`. By default only
 * strikes with a cell in the goal's delta range are listed; if none is, every strike is listed so the grid is never empty
 * when calls exist. `allStrikes` lists every strike regardless of goal.
 */
export function selectCcGridView(grid: CcGrid, goal: CcGoal, opts: { showBelowFloor: boolean; allStrikes: boolean }): CcGridView {
  const hiddenBelowFloor = opts.showBelowFloor ? 0 : grid.cells.filter(c => c.belowFloor).length;
  const visible = grid.cells.filter(c => opts.showBelowFloor || !c.belowFloor);
  const inGoalStrikes = new Set(visible.filter(c => cellInGoal(c, goal)).map(c => c.strike));
  const narrow = !opts.allStrikes && inGoalStrikes.size > 0;
  const rows = narrow ? visible.filter(c => inGoalStrikes.has(c.strike)) : visible;
  const strikes = Array.from(new Set(rows.map(c => c.strike))).sort((a, b) => a - b);
  const expirations = grid.expirations.filter(e => rows.some(c => c.expiration === e.expiration));
  const byKey = new Map(rows.map(c => [`${c.expiration}|${c.strike}`, c] as const));
  return { expirations, strikes, cell: (e, k) => byKey.get(`${e}|${k}`), hiddenBelowFloor, narrowedToGoal: narrow };
}
