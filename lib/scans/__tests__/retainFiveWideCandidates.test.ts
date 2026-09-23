import { describe, expect, it } from 'vitest';
import type { ScreenResult } from '../types';
import { retainFiveWideCandidates } from '../retainFiveWideCandidates';

const result = (width: number): ScreenResult => ({
  symbol: 'AAPL', strategy: 'BCS', bestCandidate: {
    strategy: 'BCS', expiration: '2026-11-20', dte: 35,
    shortStrike: 200, longStrike: 200 + width, spreadWidth: width,
  },
} as ScreenResult);

describe('ranked width retention', () => {
  it('keeps the five-wide candidate when the broad search chose a wider spread for the same short strike', () => {
    const broad = result(10);
    const five = result(5);
    expect(retainFiveWideCandidates([broad], [five])).toEqual([broad, five]);
    expect(retainFiveWideCandidates([five], [five])).toEqual([five]);
  });
});
