// features/portfolio/positions-workspace/model/strategyChips.ts
//
// PORTFOLIO-CHIPS-0001: one row of strategy chips (with counts) replaces the Strategy dropdown in the Filter dialog.
// Classification reads the position's legs first (strategy names are not uniform: a short put is 'PUT' in some paths and 'CSP' in others).
// Wheel is an overlay on the trader's intent setting, not a structure, so a Wheel put counts under both CSP and Wheel.

import type { Position } from '@/lib/portfolio-data/types';
import type { StrategyChipId } from './types';

export const STRATEGY_CHIPS: ReadonlyArray<{ id: StrategyChipId; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'csp', label: 'CSP' },
  { id: 'cc', label: 'CC' },
  { id: 'long', label: 'Long Options' },
  { id: 'spreads', label: 'Spreads' },
  { id: 'wheel', label: 'Wheel' },
];

const SPREAD_STRATEGIES = new Set(['BPS', 'BCS', 'IC', 'PMCC']);

/** The one structural bucket a position falls in. PMCC and every multi-leg structure count as Spreads. */
export function structuralChipOf(position: Pick<Position, 'strategy' | 'legs' | 'isPmccShortLeg'>): 'csp' | 'cc' | 'long' | 'spreads' | 'other' {
  const strategy = String(position.strategy ?? '').toUpperCase();
  if (SPREAD_STRATEGIES.has(strategy)) return 'spreads';
  if (strategy === 'CSP') return 'csp';
  if (strategy === 'CC') return 'cc';
  const legs = position.legs ?? [];
  if (legs.length > 1) return 'spreads';
  if (legs.length === 1) {
    const leg = legs[0];
    if (leg.direction === 'Long') return 'long';
    if (leg.optionType === 'P') return 'csp';
    return position.isPmccShortLeg ? 'spreads' : 'cc';
  }
  return 'other';
}

export function matchesStrategyChip(position: Pick<Position, 'strategy' | 'legs' | 'isPmccShortLeg' | 'intent'>, chip: StrategyChipId): boolean {
  if (chip === 'all') return true;
  if (chip === 'wheel') return position.intent === 'wheel';
  return structuralChipOf(position) === chip;
}

/** Count per chip over the given positions (the caller passes the rows that already pass the other filters). */
export function strategyChipCounts(positions: ReadonlyArray<Pick<Position, 'strategy' | 'legs' | 'isPmccShortLeg' | 'intent'>>): Record<StrategyChipId, number> {
  const counts: Record<StrategyChipId, number> = { all: positions.length, csp: 0, cc: 0, long: 0, spreads: 0, wheel: 0 };
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
  if (s === 'CSP' || s === 'PUT') return 'csp';
  if (s === 'CC') return 'cc';
  if (SPREAD_STRATEGIES.has(s)) return 'spreads';
  return 'all';
}
