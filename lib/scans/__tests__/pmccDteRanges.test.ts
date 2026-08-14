import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PMCC_DTE_RANGES,
  classifyPmccDte,
  isValidPmccDteRanges,
} from '../pmccDteRanges';

describe('PMCC DTE ranges', () => {
  it('uses the product defaults', () => {
    expect(DEFAULT_PMCC_DTE_RANGES).toEqual({
      shortMin: 21,
      shortMax: 45,
      longMin: 180,
      longMax: 730,
    });
  });

  it('classifies expirations using the selected fetch windows', () => {
    const ranges = { shortMin: 10, shortMax: 20, longMin: 90, longMax: 120 };

    expect(classifyPmccDte(15, ranges)).toEqual({ isShortWindow: true, isLongWindow: false });
    expect(classifyPmccDte(100, ranges)).toEqual({ isShortWindow: false, isLongWindow: true });
    expect(classifyPmccDte(45, ranges)).toEqual({ isShortWindow: false, isLongWindow: false });
  });

  it('keeps an overlapping expiration available to both PMCC legs', () => {
    const ranges = { shortMin: 21, shortMax: 365, longMin: 180, longMax: 365 };

    expect(classifyPmccDte(200, ranges)).toEqual({ isShortWindow: true, isLongWindow: true });
  });

  it('rejects non-finite, negative, and reversed ranges', () => {
    expect(isValidPmccDteRanges(DEFAULT_PMCC_DTE_RANGES)).toBe(true);
    expect(isValidPmccDteRanges({ ...DEFAULT_PMCC_DTE_RANGES, shortMin: Number.NaN })).toBe(false);
    expect(isValidPmccDteRanges({ ...DEFAULT_PMCC_DTE_RANGES, longMax: -1 })).toBe(false);
    expect(isValidPmccDteRanges({ ...DEFAULT_PMCC_DTE_RANGES, shortMin: 46 })).toBe(false);
    expect(isValidPmccDteRanges({ ...DEFAULT_PMCC_DTE_RANGES, longMin: 731 })).toBe(false);
  });
});
