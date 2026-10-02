// lib/screener/__tests__/cspStrikeRange.test.ts

import { describe, it, expect } from 'vitest';
import type { ScreenResult } from '@/lib/scans/types';
import {
  deriveSingleTickerStrikeBounds,
  formatStrikeRangeLabel,
  isStrikeRangeNarrowing,
  parseStrikeInput,
  passesStrikeRange,
} from '../cspStrikeRange';
import { candidateOtmPct } from '../candidateOtm';

const csp = (symbol: string, shortStrike: number, strategy = 'CSP') =>
  ({ symbol, strategy, bestCandidate: { strategy, shortStrike } }) as unknown as ScreenResult;

describe('CSP-STRIKE-RANGE-0001: strike bounds exist only for exactly one ticker', () => {
  it('returns the lowest and highest CSP strike for a single-ticker ladder', () => {
    expect(deriveSingleTickerStrikeBounds([csp('AMDL', 75.5), csp('AMDL', 70), csp('AMDL', 80)])).toEqual({ min: 70, max: 80 });
  });
  it('returns null for mixed tickers, no results, or no CSP candidates', () => {
    expect(deriveSingleTickerStrikeBounds([csp('AMDL', 75), csp('SOXL', 130)])).toBeNull();
    expect(deriveSingleTickerStrikeBounds([])).toBeNull();
    expect(deriveSingleTickerStrikeBounds([csp('AMDL', 75, 'BPS')])).toBeNull();
  });
});

describe('CSP-STRIKE-RANGE-0001: open bounds and inclusive range', () => {
  it('min only keeps everything at or above it', () => {
    const r = { min: 75, max: null };
    expect(passesStrikeRange(74.5, r)).toBe(false);
    expect(passesStrikeRange(75, r)).toBe(true);
    expect(passesStrikeRange(500, r)).toBe(true);
  });
  it('max only keeps everything at or below it', () => {
    const r = { min: null, max: 75 };
    expect(passesStrikeRange(1, r)).toBe(true);
    expect(passesStrikeRange(75, r)).toBe(true);
    expect(passesStrikeRange(75.5, r)).toBe(false);
  });
  it('both bounds keep the inclusive range between them', () => {
    const r = { min: 72, max: 76 };
    expect([70, 72, 75.5, 76, 77].map(s => passesStrikeRange(s, r))).toEqual([false, true, true, true, false]);
  });
  it('untouched or fully blank excludes nothing', () => {
    expect(passesStrikeRange(70, null)).toBe(true);
    expect(passesStrikeRange(70, { min: null, max: null })).toBe(true);
  });
});

describe('CSP-STRIKE-RANGE-0001: input parsing, active state and chip label', () => {
  it('blank or invalid input is an open bound', () => {
    expect(parseStrikeInput('')).toBeNull();
    expect(parseStrikeInput('  ')).toBeNull();
    expect(parseStrikeInput('abc')).toBeNull();
    expect(parseStrikeInput('-5')).toBeNull();
    expect(parseStrikeInput('75.5')).toBe(75.5);
    expect(parseStrikeInput('75.')).toBe(75);
  });
  it('is active only when it excludes part of the scan', () => {
    const b = { min: 70, max: 80 };
    expect(isStrikeRangeNarrowing(null, b)).toBe(false);
    expect(isStrikeRangeNarrowing({ min: 70, max: 80 }, b)).toBe(false);
    expect(isStrikeRangeNarrowing({ min: null, max: null }, b)).toBe(false);
    expect(isStrikeRangeNarrowing({ min: 72, max: null }, b)).toBe(true);
    expect(isStrikeRangeNarrowing({ min: null, max: 78 }, b)).toBe(true);
  });
  it('labels each bound shape', () => {
    expect(formatStrikeRangeLabel({ min: 72, max: 76 })).toBe('Strike $72–$76');
    expect(formatStrikeRangeLabel({ min: 72, max: null })).toBe('Strike ≥ $72');
    expect(formatStrikeRangeLabel({ min: null, max: 76 })).toBe('Strike ≤ $76');
  });
});

describe('CSP-STRIKE-RANGE-0001: OTM % covers CSP and CC (filter previously hid both)', () => {
  it('CSP and BPS measure the put below price; CC and BCS the call above', () => {
    expect(candidateOtmPct({ strategy: 'CSP', shortStrike: 80 }, 100)).toBeCloseTo(20);
    expect(candidateOtmPct({ strategy: 'BPS', shortStrike: 90 }, 100)).toBeCloseTo(10);
    expect(candidateOtmPct({ strategy: 'CC', shortStrike: 110 }, 100)).toBeCloseTo(10);
    expect(candidateOtmPct({ strategy: 'BCS', shortStrike: 105 }, 100)).toBeCloseTo(5);
  });
  it('IC takes the nearer side; missing price or call strike is null', () => {
    expect(candidateOtmPct({ strategy: 'IC', shortStrike: 95, shortCallStrike: 108 }, 100)).toBeCloseTo(5);
    expect(candidateOtmPct({ strategy: 'IC', shortStrike: 95 }, 100)).toBeNull();
    expect(candidateOtmPct({ strategy: 'CSP', shortStrike: 80 }, null)).toBeNull();
    expect(candidateOtmPct({ strategy: 'CSP', shortStrike: 80 }, 0)).toBeNull();
  });
});
