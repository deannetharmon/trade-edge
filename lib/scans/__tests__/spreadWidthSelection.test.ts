import { describe, expect, it } from 'vitest';
import { DEFAULT_SPREAD_WIDTH_RANGE, matchesDisplayedWidth, scanWidths } from '../spreadWidthSelection';
import type { SpreadCandidate } from '../types';

describe('spread width selection', () => {
  it('scans every $5 increment from $5 through $50 by default and respects a narrow range', () => {
    expect(scanWidths(DEFAULT_SPREAD_WIDTH_RANGE)).toEqual([5, 10, 15, 20, 25, 30, 35, 40, 45, 50]);
    expect(scanWidths({ min: 15, max: 25 })).toEqual([15, 20, 25]);
    expect(scanWidths({ min: 50, max: 50 })).toEqual([50]);
    expect(() => scanWidths({ min: 25, max: 10 })).toThrow();
  });

  it('requires both iron condor wings to match the post-scan width', () => {
    const condor = { strategy: 'IC', spreadWidth: 15, callWidth: 20 } as SpreadCandidate;
    expect(matchesDisplayedWidth(condor, 15)).toBe(false);
    expect(matchesDisplayedWidth({ ...condor, callWidth: 15 }, 15)).toBe(true);
    expect(matchesDisplayedWidth(condor, null)).toBe(true);
  });
});
