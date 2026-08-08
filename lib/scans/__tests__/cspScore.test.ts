// lib/scans/__tests__/cspScore.test.ts
// CSP-WORKFLOW-0001 core-correction pass (BLOCKER-03) — focused pure tests
// for the CSP-specific scoring module's fail-closed contract. No I/O, no
// React; every assertion is on calculateCspScore()'s return value directly.
//
// Supersedes the original renormalize-over-available-weight test suite:
// that policy is rejected as too permissive (it let a partial score look
// like a complete 0-100 number). Every one of the 9 components is now
// required; any single missing input makes the WHOLE score unavailable.

import { describe, it, expect } from 'vitest';
import { calculateCspScore, CSP_SCORE_VERSION, CSP_SCORE_CONFIG } from '../cspScore';

function fullInputs() {
  return {
    pop: 80,
    otmPct: 10, // half of the 20% cap -> 50
    periodRocPct: 2.5, // half of the 5% cap -> 50
    annualizedRocPct: 25, // half of the 50% cap -> 50
    liquidityClass: 'STRONG' as const,
    openInterest: 500,
    oiMin: 500, // exactly at the minimum -> 100
    technicalFit: 70,
    ivr: 40,
    earningsWithinExpiration: false,
  };
}

describe('calculateCspScore — component normalization (complete candidate)', () => {
  it('a complete candidate receives scoreStatus AVAILABLE and the expected total', () => {
    const result = calculateCspScore(fullInputs());
    expect(result.scoreStatus).toBe('AVAILABLE');
    expect(result.components.pop).toBe(80);
    expect(result.components.otm).toBeCloseTo(50, 5);
    expect(result.components.periodRoc).toBeCloseTo(50, 5);
    expect(result.components.annualizedRoc).toBeCloseTo(50, 5);
    expect(result.components.liquidityWidth).toBe(100); // STRONG
    expect(result.components.liquidityOi).toBe(100); // exactly at oiMin
    expect(result.components.technical).toBe(70);
    expect(result.components.ivr).toBe(40);
    expect(result.components.eventRisk).toBe(100); // no earnings before expiration
    expect(result.missingInputs).toEqual([]);
    expect(result.inputsUsed.length).toBe(9);
    expect(result.scoreVersion).toBe(CSP_SCORE_VERSION);
    expect(result.total).not.toBeNull();
    expect(result.total as number).toBeGreaterThan(0);
    expect(result.total as number).toBeLessThanOrEqual(100);
  });

  it('clamps OTM%/ROC components at their documented caps rather than exceeding 100', () => {
    const result = calculateCspScore({
      ...fullInputs(),
      otmPct: 100, periodRocPct: 50, annualizedRocPct: 500,
    });
    expect(result.components.otm).toBe(100);
    expect(result.components.periodRoc).toBe(100);
    expect(result.components.annualizedRoc).toBe(100);
  });

  it('liquidity width score uses the discrete STRONG/BORDERLINE/POOR mapping from CSP_SCORE_CONFIG', () => {
    expect(calculateCspScore({ ...fullInputs(), liquidityClass: 'BORDERLINE' }).components.liquidityWidth)
      .toBe(CSP_SCORE_CONFIG.liquidityClassScore.BORDERLINE);
    expect(calculateCspScore({ ...fullInputs(), liquidityClass: 'POOR' }).components.liquidityWidth)
      .toBe(CSP_SCORE_CONFIG.liquidityClassScore.POOR);
  });

  it('event risk: known earnings inside the window scores 0, no known earnings scores 100', () => {
    expect(calculateCspScore({ ...fullInputs(), earningsWithinExpiration: true }).components.eventRisk).toBe(0);
    expect(calculateCspScore({ ...fullInputs(), earningsWithinExpiration: false }).components.eventRisk).toBe(100);
  });
});

describe('calculateCspScore — BLOCKER-03 fail-closed: ANY missing required dimension makes the WHOLE score unavailable', () => {
  it('missing technical input makes the total unavailable, not a fabricated neutral 50', () => {
    const result = calculateCspScore({ ...fullInputs(), technicalFit: null });
    expect(result.components.technical).toBeNull();
    expect(result.scoreStatus).toBe('UNAVAILABLE');
    expect(result.total).toBeNull();
    expect(result.missingInputs).toEqual(['technical']);
  });

  it('missing IVR makes the total unavailable', () => {
    const result = calculateCspScore({ ...fullInputs(), ivr: null });
    expect(result.components.ivr).toBeNull();
    expect(result.scoreStatus).toBe('UNAVAILABLE');
    expect(result.total).toBeNull();
    expect(result.missingInputs).toEqual(['ivr']);
  });

  it('unknown event data (earningsWithinExpiration: null, distinct from "no event") makes the total unavailable, never assumed safe', () => {
    const result = calculateCspScore({ ...fullInputs(), earningsWithinExpiration: null });
    expect(result.components.eventRisk).toBeNull();
    expect(result.scoreStatus).toBe('UNAVAILABLE');
    expect(result.total).toBeNull();
    expect(result.missingInputs).toEqual(['eventRisk']);
  });

  it('every one of the 9 dimensions independently triggers UNAVAILABLE when missing alone', () => {
    const keys: Array<[string, unknown]> = [
      ['pop', null], ['otmPct', null], ['periodRocPct', null], ['annualizedRocPct', null],
      ['liquidityClass', null], ['openInterest', null], ['technicalFit', null], ['ivr', null],
      ['earningsWithinExpiration', null],
    ];
    for (const [field, value] of keys) {
      const result = calculateCspScore({ ...fullInputs(), [field]: value });
      expect(result.scoreStatus).toBe('UNAVAILABLE');
      expect(result.total).toBeNull();
    }
  });

  it('every input missing reports all 9 missing, scoreStatus UNAVAILABLE, total null -- never NaN, never a fabricated 0', () => {
    const result = calculateCspScore({
      pop: null, otmPct: null, periodRocPct: null, annualizedRocPct: null,
      liquidityClass: null, openInterest: null, oiMin: 500,
      technicalFit: null, ivr: null, earningsWithinExpiration: null,
    });
    expect(result.scoreStatus).toBe('UNAVAILABLE');
    expect(result.total).toBeNull();
    expect(result.missingInputs.length).toBe(9);
    expect(result.inputsUsed).toEqual([]);
  });
});

describe('calculateCspScore — independence and determinism', () => {
  it('two contracts on the same ticker receive distinct scores based on their own inputs', () => {
    const closerDelta = calculateCspScore({ ...fullInputs(), pop: 76, otmPct: 8 });
    const fartherDelta = calculateCspScore({ ...fullInputs(), pop: 83, otmPct: 15 });
    expect(closerDelta.scoreStatus).toBe('AVAILABLE');
    expect(fartherDelta.scoreStatus).toBe('AVAILABLE');
    expect(closerDelta.total).not.toBe(fartherDelta.total);
  });

  it('account eligibility is not an input to this module at all -- the score cannot be influenced by capital state', () => {
    // calculateCspScore's input type has no capital/account field whatsoever
    // -- this test documents that invariant structurally: the same market
    // inputs always produce the same score regardless of any external
    // capital context the caller might otherwise have in scope.
    const a = calculateCspScore(fullInputs());
    const b = calculateCspScore(fullInputs());
    expect(a.total).toBe(b.total);
  });

  it('is deterministic for identical inputs', () => {
    const a = calculateCspScore(fullInputs());
    const b = calculateCspScore(fullInputs());
    expect(a).toEqual(b);
  });
});
