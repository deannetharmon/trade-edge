// lib/scans/__tests__/leapsEntryTargets.test.ts

// The 12-to-18-month new-entry LEAP window is one variable; held-LEAP evaluation bounds stay wide.

import { describe, expect, it } from 'vitest';
import { LEAP_ENTRY_DTE_TARGET, LEAPS_DTE_MAX_CHIPS, LEAPS_DTE_MIN_CHIPS } from '../leapsEntryTargets';
import { DEFAULT_PMCC_DTE_RANGES } from '../pmccDteRanges';

describe('new-entry LEAP target window', () => {
  it('is 12 to 18 months (365 to 545 days)', () => {
    expect(LEAP_ENTRY_DTE_TARGET).toEqual({ min: 365, max: 545 });
  });

  it('ends on chips, so the default shows as selected on the LEAPS screen', () => {
    expect(LEAPS_DTE_MIN_CHIPS).toContain(LEAP_ENTRY_DTE_TARGET.min);
    expect(LEAPS_DTE_MAX_CHIPS).toContain(LEAP_ENTRY_DTE_TARGET.max);
  });

  it('the target sits inside the wide held-LEAP bounds and does not replace them', () => {
    expect(LEAP_ENTRY_DTE_TARGET.min).toBeGreaterThanOrEqual(DEFAULT_PMCC_DTE_RANGES.longMin);
    expect(LEAP_ENTRY_DTE_TARGET.max).toBeLessThanOrEqual(DEFAULT_PMCC_DTE_RANGES.longMax);
    expect({ longMin: DEFAULT_PMCC_DTE_RANGES.longMin, longMax: DEFAULT_PMCC_DTE_RANGES.longMax }).toEqual({ longMin: 180, longMax: 730 });
  });

  it('the PMCC short-call default is 30 to 45 days, never inside the 21-DTE management window', () => {
    expect(DEFAULT_PMCC_DTE_RANGES.shortMin).toBe(30);
    expect(DEFAULT_PMCC_DTE_RANGES.shortMax).toBe(45);
  });
});
