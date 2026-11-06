import { describe, it, expect } from 'vitest';
import { cspBucketFor, splitCspByDte } from '../cspDteBuckets';
import type { ScreenResult } from '../types';

// score arg is now the annualized return %; price 100, breakeven 90 (10% distance), POP 80 unless overridden
const mk = (id: string, dte: number, score: number | null, over: Record<string, number> = {}) =>
  ({ symbol: id, strategy: 'CSP', price: 100, bestCandidate: { dte, annualizedRoc: score, pop: 80, breakeven: 90, ...over } }) as unknown as ScreenResult;

describe('cspBucketFor', () => {
  it('snaps to the nearest bucket within 3 days', () => {
    expect(cspBucketFor(28)).toBe(28);
    expect(cspBucketFor(30)).toBe(28);
    expect(cspBucketFor(25)).toBe(28);
    expect(cspBucketFor(31)).toBe(28);
  });
  it('returns null outside tolerance or for bad input', () => {
    expect(cspBucketFor(10)).toBeNull();
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
  it('nothing is lost or duplicated', () => {
    const list = [mk('A', 7, 1), mk('B', 21, null), mk('C', 100, 5)];
    const { groups, rest } = splitCspByDte(list);
    expect(groups.flatMap(g => g.results).length + rest.length).toBe(3);
  });
});
