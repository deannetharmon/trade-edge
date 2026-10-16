// lib/scans/__tests__/cspScoreBreakdown.test.ts
//
// CSP-SCORE-REVIEW-0001: band mapping and the breakdown rows. The TQQQ 70P case uses the real scan
// values from the 2026-10-15 comparison (trend fit 9, IVR 45.8%, strong liquidity, OI 1,498); totals are csp-score-v3.

import { describe, expect, it } from 'vitest';
import { calculateCspScore } from '../cspScore';
import { buildCspScoreRows, cspScoreMaxPoints } from '../cspScoreBreakdown';
import { DEFAULT_SCORE_BAND_FLOORS, GREEN_MIN_ANNUALIZED_ROC_PCT, capScoreBandByReturn, returnCapNote, scoreBand } from '../scoreBands';

const TQQQ_70P = {
  pop: 62,
  otmPct: 3.7,
  periodRocPct: 330 / 7000 * 100,
  annualizedRocPct: (330 / 7000 * 100) * (365 / 29),
  liquidityClass: 'STRONG' as const,
  openInterest: 1498,
  oiMin: 500,
  technicalFit: 9,
  ivr: 45.8,
  ivrMin: 30,
  ivrMax: 70,
  earningsWithinExpiration: false,
};

describe('scoreBand', () => {
  it('uses 75 / 55 / 35 by default and includes the floor in the higher band', () => {
    expect(DEFAULT_SCORE_BAND_FLOORS).toEqual({ green: 75, yellow: 55, orange: 35 });
    expect(scoreBand(75)).toBe('green');
    expect(scoreBand(74)).toBe('yellow');
    expect(scoreBand(55)).toBe('yellow');
    expect(scoreBand(54)).toBe('orange');
    expect(scoreBand(35)).toBe('orange');
    expect(scoreBand(34)).toBe('red');
  });

  it('honours custom floors', () => {
    expect(scoreBand(70, { green: 70, yellow: 50, orange: 30 })).toBe('green');
    expect(scoreBand(49, { green: 70, yellow: 50, orange: 30 })).toBe('orange');
  });
});

describe('buildCspScoreRows', () => {
  const result = calculateCspScore(TQQQ_70P);
  const rows = buildCspScoreRows(result, {
    pop: 62, otmPct: 3.7, periodRocPct: TQQQ_70P.periodRocPct, annualizedRocPct: TQQQ_70P.annualizedRocPct,
    liquidityClass: 'STRONG', openInterest: 1498, ivr: 45.8,
  });

  it('returns the nine components and their points add up to the total', () => {
    expect(rows).toHaveLength(9);
    expect(cspScoreMaxPoints()).toBe(100);
    const sum = rows.reduce((s, r) => s + r.points, 0);
    expect(sum).toBeCloseTo(result.total as number, 6);
    expect(result.total).toBeCloseTo(68.1, 1);
  });

  it('flags the rows that lose most of their points', () => {
    const weak = rows.filter(r => r.weak).map(r => r.key).sort();
    expect(weak).toEqual(['otm', 'technical']);
    expect(rows.find(r => r.key === 'technical')?.note).toBe('Weak or unclear trend');
    expect(rows.find(r => r.key === 'otm')?.note).toBe('Full marks need 20% OTM');
  });

  it('formats the display values', () => {
    expect(rows.find(r => r.key === 'liquidityOi')?.valueText).toBe('1,498');
    expect(rows.find(r => r.key === 'liquidityWidth')?.valueText).toBe('Strong');
    expect(rows.find(r => r.key === 'eventRisk')?.valueText).toBe('None found');
    expect(rows.find(r => r.key === 'annualizedRoc')?.note).toBe('Capped at 50%');
  });

  it('returns no rows when the score is unavailable', () => {
    const missing = calculateCspScore({ ...TQQQ_70P, technicalFit: null });
    expect(missing.scoreStatus).toBe('UNAVAILABLE');
    expect(buildCspScoreRows(missing, {
      pop: 62, otmPct: 3.7, periodRocPct: 4.7, annualizedRocPct: 59, liquidityClass: 'STRONG', openInterest: 1498, ivr: 45.8,
    })).toEqual([]);
  });
});

describe('capScoreBandByReturn (CSP-SCORE-REVIEW-0001B2)', () => {
  it('holds a green score at yellow when annualized return is under 30%', () => {
    expect(GREEN_MIN_ANNUALIZED_ROC_PCT).toBe(30);
    // TQQQ 55P from the 2026-10-16 export: score 75.2, 18% annualized
    expect(capScoreBandByReturn('green', 18)).toEqual({ band: 'yellow', capped: true });
    expect(capScoreBandByReturn('green', 29.9)).toEqual({ band: 'yellow', capped: true });
  });

  it('keeps green at or above 30% and for the in-band greens in the export', () => {
    expect(capScoreBandByReturn('green', 30)).toEqual({ band: 'green', capped: false });
    // SOXL 11/13 85P (78%), 11/20 90P (92%), 11/27 90P (81%), 11/20 75P (52%)
    for (const roc of [78, 92, 81, 52]) expect(capScoreBandByReturn('green', roc).capped).toBe(false);
  });

  it('treats a missing return as not meeting the cap', () => {
    expect(capScoreBandByReturn('green', null)).toEqual({ band: 'yellow', capped: true });
    expect(capScoreBandByReturn('green', undefined).capped).toBe(true);
  });

  it('never changes a band that is not green', () => {
    for (const band of ['yellow', 'orange', 'red'] as const) {
      expect(capScoreBandByReturn(band, 1)).toEqual({ band, capped: false });
    }
  });

  it('has a plain-language note', () => {
    expect(returnCapNote()).toBe('Score reaches Strong, but annualized return is under 30%, so the band stays Acceptable.');
  });
});
