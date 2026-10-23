// features/portfolio/positions-workspace/__tests__/strategyChips.test.ts

import { describe, expect, it } from 'vitest';
import type { Position, PositionLeg } from '@/lib/portfolio-data/types';
import { chipFromLegacyStrategy, matchesStrategyChip, strategyChipCounts, structuralChipOf } from '../model/strategyChips';
import { decodePreferences } from '../model/preferences';
import { DEFAULT_FILTERS, matchesAnalysisFilters } from '../model/filters';

const leg = (direction: 'Long' | 'Short', optionType: 'C' | 'P') => ({ symbol: 'x', optionType, strikePrice: 10, direction, quantity: 1, avgOpenPrice: 1, currentPrice: 1 }) as unknown as PositionLeg;
const pos = (o: Partial<Position>) => ({ strategy: 'PUT', legs: [], intent: 'income', ...o }) as unknown as Position;

describe('structuralChipOf', () => {
  it('short put is CSP whether the strategy says PUT or CSP', () => {
    expect(structuralChipOf(pos({ strategy: 'PUT', legs: [leg('Short', 'P')] }))).toBe('csp');
    expect(structuralChipOf(pos({ strategy: 'CSP', legs: [leg('Short', 'P')] }))).toBe('csp');
  });
  it('short call is CC unless it is a PMCC short leg', () => {
    expect(structuralChipOf(pos({ strategy: 'CALL', legs: [leg('Short', 'C')] }))).toBe('cc');
    expect(structuralChipOf(pos({ strategy: 'CALL', legs: [leg('Short', 'C')], isPmccShortLeg: true }))).toBe('spreads');
  });
  it('a single long leg is Long Options (LEAP, long put)', () => {
    expect(structuralChipOf(pos({ strategy: 'CALL', legs: [leg('Long', 'C')] }))).toBe('long');
    expect(structuralChipOf(pos({ strategy: 'PUT', legs: [leg('Long', 'P')] }))).toBe('long');
  });
  it('BPS, BCS, IC, PMCC and any multi-leg structure are Spreads', () => {
    for (const strategy of ['BPS', 'BCS', 'IC', 'PMCC']) expect(structuralChipOf(pos({ strategy }))).toBe('spreads');
    expect(structuralChipOf(pos({ strategy: 'UNKNOWN', legs: [leg('Short', 'P'), leg('Long', 'P')] }))).toBe('spreads');
  });
  it('a position with no legs and an unknown strategy is in All only', () => {
    expect(structuralChipOf(pos({ strategy: 'UNKNOWN', legs: [] }))).toBe('other');
  });
});

describe('chips match, count, and migrate', () => {
  const book = [
    pos({ legs: [leg('Short', 'P')], intent: 'wheel' }),
    pos({ legs: [leg('Short', 'P')], intent: 'acquisition' }),
    pos({ strategy: 'CALL', legs: [leg('Long', 'C')], intent: 'hold' }),
    pos({ strategy: 'BPS', legs: [leg('Short', 'P'), leg('Long', 'P')] }),
  ];
  it('Wheel overlays the intent setting, so a Wheel put counts under CSP and Wheel', () => {
    expect(strategyChipCounts(book)).toEqual({ all: 4, csp: 2, cc: 0, long: 1, spreads: 1, wheel: 1 });
    expect(matchesStrategyChip(book[0], 'csp')).toBe(true);
    expect(matchesStrategyChip(book[0], 'wheel')).toBe(true);
    expect(matchesStrategyChip(book[1], 'wheel')).toBe(false);
  });
  it('the chip filter combines with the symbol filter', () => {
    const row = (p: Position, symbol: string) => ({ id: symbol, position: { ...p, symbol } as Position, symbol, strategy: p.strategy, needsAttention: false });
    expect(matchesAnalysisFilters(row(book[0], 'TQQQ'), { ...DEFAULT_FILTERS, chip: 'wheel', symbol: 'TQQQ' })).toBe(true);
    expect(matchesAnalysisFilters(row(book[0], 'TQQQ'), { ...DEFAULT_FILTERS, chip: 'wheel', symbol: 'SOXL' })).toBe(false);
    expect(matchesAnalysisFilters(row(book[2], 'UBER'), { ...DEFAULT_FILTERS, chip: 'csp' })).toBe(false);
  });
  it('an old saved Strategy filter becomes the matching chip; a saved chip wins; junk falls back to All', () => {
    const saved = (filters: Record<string, unknown>) => decodePreferences(JSON.stringify({ version: 1, filters })).filters;
    expect(saved({ strategy: 'CSP' }).chip).toBe('csp');
    expect(saved({ strategy: 'bcs' }).chip).toBe('spreads');
    expect(saved({ strategy: 'LEAPS' }).chip).toBe('all');
    expect(saved({ chip: 'wheel', strategy: 'CSP' }).chip).toBe('wheel');
    expect(saved({ chip: 'nonsense' }).chip).toBe('all');
    expect(saved({ strategy: 'CSP' }).strategy).toBe('');
    expect(chipFromLegacyStrategy('')).toBe('all');
  });
});
