// lib/trademap/displayModes.ts
//
// OPTMAP-0001 S2: the four value modes of the Trade Map grid (and, later, the
// graph). Same grid, different unit:
//   pl-dollar    profit/loss in dollars
//   pl-pct       profit/loss as a % of the capital at risk: the debit paid, or
//                for a credit trade the max loss
//   value        the strategy's value in dollars (what closing it would pay)
//   pct-max-risk profit/loss as a % of max loss
// Null (never a guess) when the basis is zero or unbounded.

import type { GridCell } from './gridModel';

export type DisplayMode = 'pl-dollar' | 'pl-pct' | 'value' | 'pct-max-risk';

export const DISPLAY_MODES: Array<{ id: DisplayMode; label: string }> = [
  { id: 'pl-dollar', label: 'Profit / Loss $' },
  { id: 'pl-pct', label: 'Profit / Loss %' },
  { id: 'value', label: 'Contract Value' },
  { id: 'pct-max-risk', label: '% of Max Risk' },
];

export interface ModeBasis {
  /** Dollars paid (positive) or received (negative) to open. */
  netDebit: number;
  /** Max loss in dollars (positive); null when unbounded. */
  maxLoss: number | null;
}

const EPS = 1e-9;

export function modeValue(mode: DisplayMode, cell: GridCell | null, basis: ModeBasis): number | null {
  if (cell == null) return null;
  switch (mode) {
    case 'pl-dollar': return cell.pl;
    case 'value': return cell.value;
    case 'pl-pct': {
      const denom = basis.netDebit > EPS ? basis.netDebit : basis.maxLoss;
      return denom != null && denom > EPS ? (cell.pl / denom) * 100 : null;
    }
    case 'pct-max-risk':
      return basis.maxLoss != null && basis.maxLoss > EPS ? (cell.pl / basis.maxLoss) * 100 : null;
    default: return null;
  }
}

export function formatModeValue(mode: DisplayMode, v: number | null): string {
  if (v == null || !Number.isFinite(v)) return '—';
  const isPct = mode === 'pl-pct' || mode === 'pct-max-risk';
  const abs = Math.abs(v);
  const body = isPct ? `${abs.toFixed(abs >= 100 ? 0 : 1)}%` : `$${Math.round(abs).toLocaleString('en-US')}`;
  return v < 0 && Math.round(abs * 10) > 0 ? `-${body}` : body;
}
