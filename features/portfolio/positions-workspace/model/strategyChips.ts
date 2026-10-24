// features/portfolio/positions-workspace/model/strategyChips.ts
//
// PORTFOLIO-CHIPS-0001: one row of strategy chips (with counts) replaces the Strategy dropdown in the Filter dialog.
// Classification reads the position's legs first (strategy names are not uniform: a short put is 'PUT' in some paths and 'CSP' in others).
// Wheel is an overlay on the trader's intent setting, not a structure, so a Wheel put counts under both CSP and Wheel.

import type { Position } from '@/lib/portfolio-data/types';
import { summaryGroupForPosition } from './portfolioSummary';
import type { StrategyChipId } from './types';

export const STRATEGY_CHIPS: ReadonlyArray<{ id: StrategyChipId; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'csp', label: 'CSP' },
  { id: 'cc', label: 'CC' },
  { id: 'long', label: 'Long Options' },
  { id: 'leap', label: 'LEAP' },
  { id: 'spreads', label: 'Spreads' },
  { id: 'pmcc', label: 'PMCC' },
  { id: 'wheel', label: 'Wheel' },
];

const SPREAD_STRATEGIES = new Set(['BPS', 'BCS', 'IC']);

/**
 * The one structural bucket a position falls in. It reads the same classifier as the P/L tiles above the table (summaryGroupForPosition),
 * so a chip count and its tile can never disagree. A PMCC short call counts under PMCC.
 */
export function structuralChipOf(position: Position): 'csp' | 'cc' | 'long' | 'leap' | 'spreads' | 'pmcc' | 'other' {
  if (position.isPmccShortLeg) return 'pmcc';
  switch (summaryGroupForPosition(position)) {
    case 'SHORT_PUTS': return 'csp';
    case 'SHORT_CALLS': return 'cc';
    case 'SPREADS': return 'spreads';
    case 'LEAPS': return 'leap';
    case 'LONG_OPTIONS': return 'long';
    case 'PMCC': return 'pmcc';
    default: return 'other';
  }
}

export function matchesStrategyChip(position: Position, chip: StrategyChipId): boolean {
  if (chip === 'all') return true;
  if (chip === 'wheel') return position.intent === 'wheel';
  return structuralChipOf(position) === chip;
}

/** Count per chip over the given positions (the caller passes the rows that already pass the other filters). */
export function strategyChipCounts(positions: ReadonlyArray<Position>): Record<StrategyChipId, number> {
  const counts: Record<StrategyChipId, number> = { all: positions.length, csp: 0, cc: 0, long: 0, leap: 0, spreads: 0, pmcc: 0, wheel: 0 };
  for (const position of positions) {
    const structural = structuralChipOf(position);
    if (structural !== 'other') counts[structural] += 1;
    if (position.intent === 'wheel') counts.wheel += 1;
  }
  return counts;
}

export function isStrategyChipId(value: unknown): value is StrategyChipId {
  return typeof value === 'string' && STRATEGY_CHIPS.some(chip => chip.id === value);
}

/** Saved preferences from before the chips stored a Strategy string; carry it over so a saved filter does not silently vanish. */
export function chipFromLegacyStrategy(strategy: string): StrategyChipId {
  const s = strategy.trim().toUpperCase();
  if (s === 'PMCC') return 'pmcc';
  if (s === 'CSP' || s === 'PUT') return 'csp';
  if (s === 'CC') return 'cc';
  if (SPREAD_STRATEGIES.has(s)) return 'spreads';
  return 'all';
}
