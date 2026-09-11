import { describe, expect, it } from 'vitest';
import {
  evaluateHeldLeapsRunway,
  evaluateLeapsWindow,
  evaluatePmccCushion,
  evaluateShortCallCadence,
  PMCC_FINDER_POLICY_VERSIONS,
} from '../pmccFinderPolicy';

describe('PMCC finder policy V1 shadow contracts', () => {
  it('uses explicit shadow policy versions', () => {
    expect(Object.values(PMCC_FINDER_POLICY_VERSIONS).every(value => value.endsWith('-shadow'))).toBe(true);
  });

  it.each([
    ['7-day', 5, 0.15, true], ['7-day', 9, 0.22, true],
    ['14-day', 10, 0.18, true], ['14-day', 18, 0.25, true],
    ['30-45-day', 25, 0.20, true], ['30-45-day', 45, 0.30, true],
  ] as const)('%s accepts its DTE and preferred delta boundary', (cadence, dte, delta, preferred) => {
    const result = evaluateShortCallCadence(dte, delta, cadence);
    expect(result.supported).toBe(true);
    expect(result.preferred).toBe(preferred);
  });

  it.each([
    ['7-day', 4, 0.20], ['7-day', 10, 0.20],
    ['14-day', 9, 0.20], ['14-day', 19, 0.20],
    ['30-45-day', 24, 0.25], ['30-45-day', 46, 0.25],
  ] as const)('%s rejects DTE %s immediately outside its range', (cadence, dte, delta) => {
    expect(evaluateShortCallCadence(dte, delta, cadence).supported).toBe(false);
  });

  it('keeps 19–24 DTE visible only to Auto gap inspection', () => {
    expect(evaluateShortCallCadence(19, 0.20, 'auto')).toMatchObject({ supported: true, preferred: false, matchedCadence: 'auto-gap' });
    expect(evaluateShortCallCadence(24, 0.20, 'auto')).toMatchObject({ supported: true, preferred: false, matchedCadence: 'auto-gap' });
    expect(evaluateShortCallCadence(19, 0.20, '14-day').supported).toBe(false);
    expect(evaluateShortCallCadence(24, 0.20, '30-45-day').supported).toBe(false);
  });

  it.each([0.09, 0.36])('rejects delta %s outside the global short-call boundary', delta => {
    expect(evaluateShortCallCadence(7, delta, 'auto').supported).toBe(false);
  });

  it.each([0.10, 0.35])('accepts delta %s at the global short-call boundary', delta => {
    expect(evaluateShortCallCadence(7, delta, 'auto').supported).toBe(true);
  });

  it('distinguishes supported, primary, and preferred LEAPS boundaries', () => {
    expect(evaluateLeapsWindow(180, 0.65, 'new')).toMatchObject({ supported: true, primaryRecommendationEligible: false, preferred: false });
    expect(evaluateLeapsWindow(365, 0.70, 'new')).toMatchObject({ supported: true, primaryRecommendationEligible: true, preferred: false });
    expect(evaluateLeapsWindow(540, 0.75, 'new')).toMatchObject({ supported: true, primaryRecommendationEligible: true, preferred: true });
    expect(evaluateLeapsWindow(900, 0.85, 'new')).toMatchObject({ supported: true, primaryRecommendationEligible: true, preferred: true });
  });

  it.each([
    [179, 0.75], [901, 0.75], [540, 0.64], [540, 0.91],
  ])('rejects new LEAPS outside support boundaries: %s DTE / %s delta', (dte, delta) => {
    expect(evaluateLeapsWindow(dte, delta, 'new').supported).toBe(false);
  });

  it.each([
    [364, 0.75, false, false], [365, 0.70, true, false],
    [539, 0.75, true, false], [540, 0.75, true, true],
    [540, 0.64, false, false], [540, 0.65, false, false],
    [540, 0.70, true, false], [540, 0.75, true, true],
    [540, 0.85, true, true], [540, 0.90, true, false], [540, 0.91, false, false],
  ] as const)('classifies primary/preferred LEAPS boundary %s DTE / %s delta', (dte, delta, primary, preferred) => {
    expect(evaluateLeapsWindow(dte, delta, 'new')).toMatchObject({ primaryRecommendationEligible: primary, preferred });
  });

  it('does not apply new-entry boundaries as a retroactive held-contract gate', () => {
    const held = evaluateLeapsWindow(120, 0.60, 'held');
    expect(held.supported).toBe(true);
    expect(held.primaryRecommendationEligible).toBe(true);
    expect(held.warnings).not.toHaveLength(0);
  });

  it('uses the greater of $1 or 3% of debit for recommendation cushion', () => {
    const dollarFloor = evaluatePmccCushion(20, 21);
    expect(dollarFloor.minimumRecommendationCushionPerShare).toBe(1);
    expect(dollarFloor.recommendationEligible).toBe(true);

    const percentageFloor = evaluatePmccCushion(50, 51.5);
    expect(percentageFloor.minimumRecommendationCushionPerShare).toBe(1.5);
    expect(percentageFloor.recommendationEligible).toBe(true);
  });

  it('classifies positive but insufficient cushion as a near-miss boundary', () => {
    const result = evaluatePmccCushion(49.81, 50);
    expect(result.structurallyValid).toBe(true);
    expect(result.cushionPerShare).toBeCloseTo(0.19, 8);
    expect(result.recommendationEligible).toBe(false);
  });

  it.each([
    [20, 20.99, false], [20, 21, true], [20, 21.01, true],
    [50, 51.49, false], [50, 51.5, true], [50, 51.51, true],
  ] as const)('classifies cushion around its floor for debit %s / width %s', (debit, width, eligible) => {
    expect(evaluatePmccCushion(debit, width).recommendationEligible).toBe(eligible);
  });

  it.each([
    [29, 'fail'], [30, 'caution'], [89, 'caution'], [90, 'preferred'],
  ] as const)('classifies held-long runway at %s days as %s', (days, status) => {
    expect(evaluateHeldLeapsRunway(days).status).toBe(status);
  });
});
