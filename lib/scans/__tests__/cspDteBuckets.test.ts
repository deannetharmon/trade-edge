import { describe, it, expect } from 'vitest';
import { cspBucketFor, splitCspByDte } from '../cspDteBuckets';
import type { ScreenResult } from '../types';

// score arg is now the annualized return %; price 100, breakeven 90 (10% distance), POP 80 unless overridden
const mk = (id: string, dte: number, score: number | null, over: Record<string, number> = {}) =>
  ({ symbol: id, strategy: 'CSP', price: 100, bestCandidate: { dte, annualizedRoc: score, cspExtrinsicAnnualizedRoc: score, shortStrike: 90, pop: 80, breakeven: 90, cspLiquidityClass: 'STRONG', shortOI: 1000, ...(over as object) } }) as unknown as ScreenResult;

describe('cspBucketFor', () => {
  it('snaps to the nearest bucket within 3 days', () => {
    expect(cspBucketFor(28)).toBe(28);
    expect(cspBucketFor(30)).toBe(28);
    expect(cspBucketFor(25)).toBe(28);
    expect(cspBucketFor(10)).toBe(7);
    expect(cspBucketFor(31)).toBe(28);
  });
  it('returns null outside tolerance or for bad input', () => {
    expect(cspBucketFor(2)).toBeNull();
    expect(cspBucketFor(60)).toBeNull();
    expect(cspBucketFor(null)).toBeNull();
  });
});

describe('splitCspByDte', () => {
  it('picks exactly one per bucket (best annualized return), rest keeps incoming order', () => {
    const list = [mk('A', 28, 50), mk('B', 28, 90), mk('C', 28, 70), mk('D', 28, 60), mk('E', 14, 40), mk('F', 60, 99)];
    const { groups, rest } = splitCspByDte(list);
    expect(groups.map(g => g.bucket)).toEqual([14, 28]);
    expect(groups.every(g => g.results.length === 1)).toBe(true);
    expect(groups[1].results.map(r => r.symbol)).toEqual(['B']);
    expect(rest.map(r => r.symbol)).toEqual(['A', 'C', 'D', 'F']);
  });
  it('a trade below the POP floor loses to a lower-yield trade that clears all floors', () => {
    const list = [mk('HI', 28, 80, { pop: 50 }), mk('OK', 28, 15)];
    expect(splitCspByDte(list).groups[0].results.map(r => r.symbol)).toEqual(['OK']);
  });
  it('wheel intent accepts lower POP / tighter distance that premium rejects', () => {
    const list = [mk('LOW', 28, 12, { pop: 80, breakeven: 90 }), mk('ATM', 28, 40, { pop: 50, breakeven: 98 })];
    expect(splitCspByDte(list, 'premium').groups[0].results[0].symbol).toBe('LOW');
    expect(splitCspByDte(list, 'wheel').groups[0].results[0].symbol).toBe('ATM');
  });
  it('a poor-spread or thin-OI trade loses to a lower-yield liquid one', () => {
    const list = [mk('WIDE', 28, 60, { cspLiquidityClass: 'POOR' as any }), mk('THIN', 28, 50, { shortOI: 18 }), mk('OK', 28, 12)];
    expect(splitCspByDte(list).groups[0].results.map(r => r.symbol)).toEqual(['OK']);
  });
  it('PICK-OTM-0001: an ITM put with a huge raw return loses to an OTM one; with nothing clearing the floors the line is empty', () => {
    const itm = mk('ITM', 28, 284, { shortStrike: 105, pop: 44 });
    const otmOk = mk('OTM', 28, 12);
    expect(splitCspByDte([itm, otmOk]).groups[0].results.map(r => r.symbol)).toEqual(['OTM']);
    // NO-JUNK-PICK-0001: when nothing clears the floors, the DTE has an empty line, not a filler pick.
    const lowPop = mk('LOWPOP', 28, 60, { pop: 41 });
    const safer = mk('SAFER', 28, 5, { pop: 78 });
    const g = splitCspByDte([lowPop, safer]).groups[0];
    expect(g.results).toEqual([]);
    expect(splitCspByDte([lowPop, safer]).rest.map(r => r.symbol)).toEqual(['LOWPOP', 'SAFER']);
  });
  it('uses extrinsic annualized return, not the raw figure', () => {
    const rawHigh = mk('RAW', 28, 10, { annualizedRoc: 90 });
    const extHigh = mk('EXT', 28, 30);
    expect(splitCspByDte([rawHigh, extHigh]).groups[0].results.map(r => r.symbol)).toEqual(['EXT']);
  });
  it('nothing is lost or duplicated', () => {
    const list = [mk('A', 7, 1), mk('B', 21, null), mk('C', 100, 5)];
    const { groups, rest } = splitCspByDte(list);
    expect(groups.flatMap(g => g.results).length + rest.length).toBe(3);
  });
});
