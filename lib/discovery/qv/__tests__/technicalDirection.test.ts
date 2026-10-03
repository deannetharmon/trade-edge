// lib/discovery/qv/__tests__/technicalDirection.test.ts

// LEAPS-QV-0001 Gate 3 review corrections 1-3 -- Technical State confluence and missing-trend semantics.
// Levels are never read as directions; evidence that is not available fails closed; known adverse evidence stands.

import { describe, expect, it } from 'vitest';
import { assessFundamentals, assessTechnical, growthTrajectoryOf, technicalStateOf } from '..';
import { codesOf, evaluate, idOf, invalid, metricsWith, stale, stateOf, unavailable } from './qvFixtures';
import type { Field } from './qvFixtures';

const tech = (overrides: Parameters<typeof metricsWith>[0] = {}) => assessTechnical(metricsWith(overrides));

describe('Technical State confluence (Section 45.8)', () => {
  it('the full confluence is RECOVERING; one missing/failed RECOVERING element is at most STABILIZING', () => {
    expect(tech().result).toBe('RECOVERING');
    expect(tech({ weeklyRsiSlope: 0 }).result).toBe('STABILIZING'); // slope not rising
    expect(tech({ weeklyRsiChange: 0 }).result).toBe('STABILIZING'); // 4-week change not positive
    expect(tech({ sma50GapChange: 0 }).result).toBe('STABILIZING'); // relationship to SMA50 not improving
    expect(tech({ relativeStrengthChange: 0 }).result).toBe('STABILIZING'); // relative strength not improving
  });

  it('flat/rising 4-week RSI change with a negative weekly RSI slope does NOT establish STABILIZING', () => {
    [0, 3].forEach((change) => {
      const result = tech({ weeklyRsiChange: change, weeklyRsiSlope: -1 }).result;
      expect(['STABILIZING', 'RECOVERING']).not.toContain(result);
    });
  });

  it('flat/rising RSI with continuing adverse technical evidence is not STABILIZING by itself', () => {
    const adverse = { weeklyRsiChange: 1, weeklyRsiSlope: -1, relativeStrengthChange: -2, price: 80, relativeStrength: -5 };
    const assessment = tech(adverse);
    expect(assessment.result).toBe('DECLINING');
    expect(stateOf(evaluate(adverse))).toBe('WATCH');
  });

  it('a positive relative-strength LEVEL does not prove improving direction', () => {
    expect(tech({ relativeStrength: 40, relativeStrengthChange: -1 }).result).toBe('DECLINING'); // level high, direction worsening
    expect(tech({ relativeStrength: 40, relativeStrengthChange: 0 }).result).toBe('STABILIZING'); // not worsening, but not improving
    expect(tech({ relativeStrength: 40, relativeStrengthChange: null }).result).toBe('NOT_EVALUABLE'); // level alone proves nothing
  });

  it('price ABOVE SMA50 does not prove an improving relationship to SMA50', () => {
    expect(tech({ price: 150, sma50: 95, sma50GapChange: -2 }).result).toBe('STABILIZING');
    expect(tech({ price: 150, sma50: 95, sma50GapChange: null }).result).toBe('STABILIZING'); // RECOVERING fails closed
    expect(tech({ price: 150, sma50: 95, sma50GapChange: null }).missingDirectionMetricIds).toEqual([idOf('sma50GapChange')]);
    expect(codesOf(evaluate({ sma50GapChange: null }))).toContain('DATA_TECHNICAL_DIRECTION_UNAVAILABLE');
    expect(stateOf(evaluate({ sma50GapChange: null }))).toBe('SETUP'); // not ACTIONABLE without the evidence
  });

  it('price BELOW SMA50 is allowed for STABILIZING (spec) and is not itself an adverse override', () => {
    expect(tech({ price: 90, sma50: 95, weeklyRsiSlope: 0 }).result).toBe('STABILIZING');
  });

  it('unavailable direction evidence fails closed: no STABILIZING/RECOVERING and the domain is NOT_EVALUABLE', () => {
    (['weeklyRsiSlope', 'relativeStrengthChange'] as Field[]).forEach((field) => {
      [null, unavailable(field), stale(field), invalid(field)].forEach((metric) => {
        const assessment = tech({ [field]: metric });
        expect(assessment.result, `${field}`).toBe('NOT_EVALUABLE');
        expect(assessment.blockingMetricIds).toContain(idOf(field));
        const evaluation = evaluate({ [field]: metric });
        expect(stateOf(evaluation)).toBe('INSUFFICIENT_DATA');
        expect(codesOf(evaluation)).toContain('DATA_TECHNICAL_DIRECTION_UNAVAILABLE');
      });
    });
  });

  it('known adverse evidence stands even when direction evidence is unavailable', () => {
    const adverse = { weeklyRsiChange: -3, weeklyRsiSlope: null, relativeStrengthChange: null, price: 80 };
    expect(tech(adverse).result).toBe('DECLINING');
    expect(tech({ ...adverse, price: 100, weeklyRsi: 25 }).result).toBe('OVERSOLD');
    expect(stateOf(evaluate(adverse))).toBe('WATCH');
  });

  it('technicalStateOf: no element is inferred from another', () => {
    const base = {
      weeklyRsiSlopeNonNegative: true, rsiChange4wNonNegative: true, relativeStrengthNotWorsening: true,
      weeklyRsiSlopePositive: true, rsiChange4wPositive: true, smaGapImproving: true, relativeStrengthImproving: true,
      weeklyRsiDepressed: false, priceBelowSma50: false, belowFallingSma200: false, relativeStrengthNegative: false, otherBearishCount: 0,
    };
    expect(technicalStateOf(base)).toBe('RECOVERING');
    expect(technicalStateOf({ ...base, smaGapImproving: null })).toBe('STABILIZING');
    expect(technicalStateOf({ ...base, weeklyRsiSlopeNonNegative: null, weeklyRsiSlopePositive: null })).toBeNull();
    expect(technicalStateOf({ ...base, weeklyRsiSlopeNonNegative: false, weeklyRsiSlopePositive: false })).toBe('DECLINING');
  });

  it('existing legitimate cases still qualify with sufficient evidence', () => {
    expect(stateOf(evaluate({ weeklyRsiSlope: 0 }))).toBe('SETUP');
    expect(stateOf(evaluate())).toBe('ACTIONABLE');
  });
});

describe('missing fundamental-trend semantics', () => {
  it('non-negative growth with no trend reference is not evaluable -- never STABLE or IMPROVING', () => {
    expect(growthTrajectoryOf(4, null)).toBeNull();
    expect(growthTrajectoryOf(0, null)).toBeNull();
    expect(growthTrajectoryOf(4, 5)).toBe('STABLE');
    expect(growthTrajectoryOf(6, 5)).toBe('IMPROVING');
  });

  it('negative growth is independently adverse and stays DETERIORATING without a trend', () => {
    expect(growthTrajectoryOf(-2, null)).toBe('DETERIORATING');
  });

  it('missing/stale/invalid EPS trend never silently establishes STABLE', () => {
    [null, unavailable('epsTrend'), stale('epsTrend'), invalid('epsTrend')].forEach((metric) => {
      const fundamentals = assessFundamentals(metricsWith({ epsTrend: metric }));
      const eps = fundamentals.dimensions.find((d) => d.dimension === 'EPS');
      expect(eps?.state).toBe('NOT_EVALUABLE');
      expect(eps?.blockingMetricIds).toEqual([idOf('epsTrend')]);
      expect(fundamentals.reasons.map((r) => r.code)).toContain('DATA_TREND_REFERENCE_UNAVAILABLE');
    });
  });

  it('with the EPS trend missing, too few dimensions remain evaluable: INSUFFICIENT_DATA, not a pass', () => {
    const evaluation = evaluate({ epsTrend: null, marginChange: null });
    expect(stateOf(evaluation)).toBe('INSUFFICIENT_DATA');
  });

  it('a missing EPS trend does not hide independently supported adverse EPS evidence', () => {
    const fundamentals = assessFundamentals(metricsWith({ epsTrend: null, epsGrowth: -8 }));
    expect(fundamentals.dimensions.find((d) => d.dimension === 'EPS')?.state).toBe('DETERIORATING');
  });
});
