import { describe, it, expect } from 'vitest';
import { computeExpectedMove } from '../expectedMove';

describe('computeExpectedMove', () => {
  it('computes a real expected move for a realistic case', () => {
    // $100 stock, 30% IV, 31 DTE
    const result = computeExpectedMove(100, 30, 31);
    expect(result).not.toBeNull();
    expect(result).toBeCloseTo(100 * 0.30 * Math.sqrt(31 / 365), 4);
    expect(result).toBeCloseTo(8.75, 1);
  });

  it("matches Ian's exact worked case: SOXL-style 31 DTE, 31% IVx, $104.50 underlying", () => {
    const result = computeExpectedMove(104.5, 31, 31);
    const expected = 104.5 * 0.31 * Math.sqrt(31 / 365);
    expect(result).toBeCloseTo(expected, 4);
  });

  it('scales with DTE — a longer-dated expiration has a larger expected move at the same IV', () => {
    const shortDte = computeExpectedMove(100, 30, 7);
    const longDte = computeExpectedMove(100, 30, 60);
    expect(longDte).toBeGreaterThan(shortDte!);
  });

  it('scales with IV — higher IV means a larger expected move at the same DTE', () => {
    const lowIv = computeExpectedMove(100, 15, 31);
    const highIv = computeExpectedMove(100, 60, 31);
    expect(highIv).toBeGreaterThan(lowIv!);
  });

  it('returns null when IVx is unavailable — the honest gap, not a bug (Ian)', () => {
    expect(computeExpectedMove(100, null, 31)).toBeNull();
  });

  it('returns null when IVx is zero or negative', () => {
    expect(computeExpectedMove(100, 0, 31)).toBeNull();
    expect(computeExpectedMove(100, -5, 31)).toBeNull();
  });

  it('returns null when underlying price is missing or non-positive', () => {
    expect(computeExpectedMove(null, 30, 31)).toBeNull();
    expect(computeExpectedMove(0, 30, 31)).toBeNull();
    expect(computeExpectedMove(-10, 30, 31)).toBeNull();
  });

  it('returns null when DTE is missing, zero, negative, or non-finite', () => {
    expect(computeExpectedMove(100, 30, 0)).toBeNull();
    expect(computeExpectedMove(100, 30, -5)).toBeNull();
    expect(computeExpectedMove(100, 30, NaN)).toBeNull();
    expect(computeExpectedMove(100, 30, Infinity)).toBeNull();
  });

  it('correctly converts IVx from percentage to decimal (normalizeIv stores it as e.g. 30, not 0.30)', () => {
    // If this conversion were wrong (treating 30 as 3000% or 0.30 instead
    // of 30%), this result would be off by two orders of magnitude.
    const result = computeExpectedMove(100, 30, 365);
    // At DTE=365, sqrt(365/365)=1, so result should equal underlyingPrice * 0.30 = 30
    expect(result).toBeCloseTo(30, 4);
  });
});
