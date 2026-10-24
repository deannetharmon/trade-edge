// features/portfolio/positions-workspace/__tests__/strategyChips.test.ts

import { describe, expect, it } from 'vitest';
import type { Position, PositionLeg } from '@/lib/portfolio-data/types';
import { chipFromLegacyStrategy, matchesStrategyChip, strategyChipCounts, structuralChipOf } from '../model/strategyChips';
import { decodePreferences } from '../model/preferences';
import { DEFAULT_FILTERS, matchesAnalysisFilters } from '../model/filters';
import { positionInSummaryGroup } from '../model/portfolioSummary';

const leg = (direction: 'Long' | 'Short', optionType: 'C' | 'P') => ({ symbol: 'x', optionType, strikePrice: 10, direction, quantity: 1, avgOpenPrice: 1, currentPrice: 1 }) as unknown as PositionLeg;
const occ = (root: string, ymd: string, type: 'C' | 'P', strike: number, direction: 'Long' | 'Short') => ({ symbol: `${root.padEnd(6)}${ymd}${type}${String(Math.round(strike * 1000)).padStart(8, '0')}`, optionType: type, strikePrice: strike, direction, quantity: 1, avgOpenPrice: 1, currentPrice: 1 }) as unknown as PositionLeg;
const pos = (o: Partial<Position>) => ({ strategy: 'PUT', legs: [], intent: 'income', ...o }) as unknown as Position;

describe('structuralChipOf', () => {
  it('short put is CSP whether the strategy says PUT or CSP', () => {
    expect(structuralChipOf(pos({ strategy: 'PUT', legs: [leg('Short', 'P')] }))).toBe('csp');
    expect(structuralChipOf(pos({ strategy: 'CSP', legs: [leg('Short', 'P')] }))).toBe('csp');
  });
  it('short call is CC unless it is a PMCC short leg', () => {
    expect(structuralChipOf(pos({ strategy: 'CALL', legs: [leg('Short', 'C')] }))).toBe('cc');
    expect(structuralChipOf(pos({ strategy: 'CALL', legs: [leg('Short', 'C')], isPmccShortLeg: true }))).toBe('pmcc');
  });
  it('a single long leg is Long Options (LEAP, long put)', () => {
    expect(structuralChipOf(pos({ strategy: 'CALL', legs: [leg('Long', 'C')] }))).toBe('long');
    expect(structuralChipOf(pos({ strategy: 'PUT', legs: [leg('Long', 'P')] }))).toBe('long');
  });
  it('BPS, BCS and IC are Spreads; an unrecognised structure is Other', () => {
    for (const strategy of ['BPS', 'BCS', 'IC']) expect(structuralChipOf(pos({ strategy, legs: [occ('SPY', '261120', 'P', 500, 'Short'), occ('SPY', '261120', 'P', 495, 'Long')] }))).toBe('spreads');
    // Anything the tiles file under Other (an unrecognised structure) is in All only, so chips and tiles never disagree.
    expect(structuralChipOf(pos({ strategy: 'UNKNOWN', legs: [leg('Short', 'P'), leg('Long', 'P')] }))).toBe('other');
  });
  it('a position with no legs and an unknown strategy is in All only', () => {
    expect(structuralChipOf(pos({ strategy: 'UNKNOWN', legs: [] }))).toBe('other');
  });
});

describe('LEAP, PMCC and Long Options', () => {
  const far = '270917'; const near = '261120';
  it('a standalone long call far out is a LEAP; a short-dated long call or put stays in Long Options, never both', () => {
    const leap = pos({ strategy: 'CALL', legs: [occ('UBER', far, 'C', 67.5, 'Long')] });
    expect(structuralChipOf(leap)).toBe('leap');
    expect(structuralChipOf(pos({ strategy: 'PUT', legs: [occ('MRNA', near, 'P', 140, 'Long')] }))).toBe('long');
    const counts = strategyChipCounts([leap]);
    expect(counts.leap).toBe(1); expect(counts.long).toBe(0);
  });
  it('a LEAP with a short call against it is a PMCC, and the short call alone is flagged as a PMCC leg', () => {
    expect(structuralChipOf(pos({ strategy: 'PMCC', legs: [occ('UBER', far, 'C', 67.5, 'Long'), occ('UBER', near, 'C', 90, 'Short')] }))).toBe('pmcc');
  });
  it('a saved PMCC filter migrates to the PMCC chip', () => { expect(chipFromLegacyStrategy('PMCC')).toBe('pmcc'); });
});

describe('chips reconcile with the P/L tiles', () => {
  it('every chip count equals the matching tile group count, and every option lands in exactly one', () => {
    const far = '270917'; const near = '261120';
    const book = [
      pos({ strategy: 'CSP', legs: [occ('TQQQ', near, 'P', 60, 'Short')] }),
      pos({ strategy: 'PUT', legs: [occ('METU', near, 'P', 28.5, 'Short')] }),
      pos({ strategy: 'CALL', legs: [occ('UBER', far, 'C', 67.5, 'Long')] }),
      pos({ strategy: 'CALL', legs: [occ('NFLX', far, 'C', 70, 'Long')] }),
      pos({ strategy: 'PUT', legs: [occ('MRNA', near, 'P', 140, 'Long')] }),
      pos({ strategy: 'BPS', legs: [occ('SPY', near, 'P', 500, 'Short'), occ('SPY', near, 'P', 495, 'Long')] }),
    ];
    const counts = strategyChipCounts(book);
    const tile = (g: Parameters<typeof positionInSummaryGroup>[1]) => book.filter(p => positionInSummaryGroup(p, g)).length;
    expect(counts.csp).toBe(tile('SHORT_PUTS'));
    expect(counts.cc).toBe(tile('SHORT_CALLS'));
    expect(counts.leap).toBe(tile('LEAPS'));
    expect(counts.long).toBe(tile('LONG_OPTIONS'));
    expect(counts.spreads).toBe(tile('SPREADS'));
    expect(counts.pmcc).toBe(tile('PMCC'));
    expect(counts.csp + counts.cc + counts.leap + counts.long + counts.spreads + counts.pmcc).toBe(book.length);
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
    expect(strategyChipCounts(book)).toEqual({ all: 4, csp: 2, cc: 0, long: 1, leap: 0, spreads: 1, pmcc: 0, stock: 0, wheel: 1 });
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
