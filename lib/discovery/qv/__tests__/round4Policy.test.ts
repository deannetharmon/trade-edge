// lib/discovery/qv/__tests__/round4Policy.test.ts

// LEAPS-QV-0001 Gate 3 review round 4 -- ratified policy behavior (A1, A2, A3, A5, A6). Each case pins one ratified ruling.

import { describe, expect, it } from 'vitest';
import { assessFundamentals, assessQuality, assessRisk, assessTechnical, growthTrajectoryOf, marginTrajectoryOf, QV_V1_0_ASSUMPTIONS } from '..';
import { classifyFcfPattern, fcfBelowLatestFiscalYear, fcfLevelOf, fcfTrajectory } from '../fcf';
import { codesOf, evaluate, metricsWith, stateOf, unavailable } from './qvFixtures';

const gate = (evaluation: ReturnType<typeof evaluate>, id: string) => evaluation.gateOutcomes.find((g) => g.gateId === id)?.result;
const context = { leverageBand: null, valuationConflict: false, deterioratingDimensions: 0 } as const;

describe('A1 revenue/EPS trajectory (ratified)', () => {
  it('negative growth is DETERIORATING whether above, below or without a negative trend', () => {
    expect(growthTrajectoryOf(-2, -5)).toBe('DETERIORATING'); // better than trend, still contracting
    expect(growthTrajectoryOf(-8, -5)).toBe('DETERIORATING');
    expect(growthTrajectoryOf(-2, null)).toBe('DETERIORATING');
    expect(growthTrajectoryOf(-2, 10)).toBe('DETERIORATING');
  });

  it('positive growth materially below trend is NOT automatically DETERIORATING; the slowdown is reported separately', () => {
    expect(growthTrajectoryOf(1, 12)).toBe('STABLE');
    const assessment = assessFundamentals(metricsWith({ revenueGrowth: 1, revenueCagr: 12 }));
    expect(assessment.deterioratingCount).toBe(0);
    expect(assessment.reasons.map((r) => r.code)).toContain('FUNDAMENTAL_GROWTH_SLOWDOWN_CONTEXT');
    expect(assessFundamentals(metricsWith({ revenueGrowth: 13, revenueCagr: 12, epsGrowth: 6 })).reasons.map((r) => r.code)).not.toContain('FUNDAMENTAL_GROWTH_SLOWDOWN_CONTEXT');
  });

  it('non-negative growth with no trend remains not evaluable', () => {
    expect(growthTrajectoryOf(4, null)).toBeNull();
  });

  it('end to end: negative revenue growth against a worse trend counts as a deteriorating dimension', () => {
    const assessment = assessFundamentals(metricsWith({ revenueGrowth: -2, revenueCagr: -5 }));
    expect(assessment.dimensions.find((d) => d.dimension === 'REVENUE')?.state).toBe('DETERIORATING');
  });
});

describe('A2 operating margin (ratified): exact +/-1 pp boundaries', () => {
  it('< -1 DETERIORATING; -1..+1 inclusive STABLE; > +1 IMPROVING', () => {
    expect(marginTrajectoryOf(-1.01)).toBe('DETERIORATING');
    expect(marginTrajectoryOf(-1)).toBe('STABLE');
    expect(marginTrajectoryOf(0)).toBe('STABLE');
    expect(marginTrajectoryOf(1)).toBe('STABLE');
    expect(marginTrajectoryOf(1.01)).toBe('IMPROVING');
  });
});

describe('A3 free cash flow (ratified): level separate from annual trajectory', () => {
  it('zero is BREAKEVEN, not negative', () => {
    expect(fcfLevelOf(0)).toBe('BREAKEVEN');
    expect(fcfLevelOf(-0.01)).toBe('NEGATIVE');
    expect(fcfLevelOf(0.01)).toBe('POSITIVE');
    expect(classifyFcfPattern(0, null)).toBe('BREAKEVEN'); // not negative: needs no annual history, never a weakness
    const quality = assessQuality(metricsWith({ fcf: 0 }));
    expect(quality.fcfPattern).toBe('BREAKEVEN');
    expect(quality.result).toBe('PASS');
    expect(quality.reasons.map((r) => r.code)).toContain('QUALITY_FCF_BREAKEVEN');
  });

  it('zero annual points are not negative observations', () => {
    expect(classifyFcfPattern(-1, [0, 0, 5])).toBe('NEGATIVE_TEMPORARY');
    expect(classifyFcfPattern(-1, [-3, 0, 5])).toBe('NEGATIVE_TEMPORARY');
  });

  it('overlapping TTM and latest fiscal year are not double-counted toward persistence', () => {
    // TTM -1 and latest FY -5 describe overlapping periods: only ONE negative annual observation.
    expect(classifyFcfPattern(-1, [20, 10, -5])).not.toBe('NEGATIVE_PERSISTENT');
    expect(classifyFcfPattern(-1, [5, 6, -5])).toBe('NEGATIVE_TEMPORARY');
  });

  it('two non-overlapping negative annual periods establish persistence (and one does not)', () => {
    expect(classifyFcfPattern(-1, [-5, 4, -2])).toBe('NEGATIVE_PERSISTENT');
    expect(classifyFcfPattern(-1, [5, -3, -2])).toBe('NEGATIVE_PERSISTENT');
    expect(classifyFcfPattern(-1, [-5, -3, -2])).toBe('NEGATIVE_PERSISTENT');
    expect(classifyFcfPattern(-1, [5, -1, 4])).toBe('NEGATIVE_TEMPORARY');
  });

  it('strictly falling annual history with a negative level is DETERIORATING_INTO_NEGATIVE', () => {
    expect(classifyFcfPattern(-1, [30, 20, 10])).toBe('DETERIORATING_INTO_NEGATIVE');
  });

  it('fails closed: a NEGATIVE level without three annual points is NOT_EVALUABLE', () => {
    expect(classifyFcfPattern(-1, null)).toBe('NOT_EVALUABLE');
    expect(classifyFcfPattern(-1, [5, -1])).toBe('NOT_EVALUABLE');
    expect(classifyFcfPattern(null, [5, 5, 5])).toBe('NOT_EVALUABLE');
    expect(assessQuality(metricsWith({ fcf: -1 })).result).toBe('NOT_EVALUABLE');
  });

  it('historical trajectory comes from annual observations only', () => {
    expect(fcfTrajectory(35, [10, 20, 30])).toBe('IMPROVING');
    expect(fcfTrajectory(5, [30, 20, 10])).toBe('STABLE');
    expect(fcfTrajectory(0, [30, 20, 10])).toBe('DETERIORATING');
    expect(fcfTrajectory(0, null)).toBeNull();
    expect(fcfTrajectory(5, null)).toBeNull();
  });
});

describe('A5 technical (ratified)', () => {
  const tech = (overrides: Parameters<typeof metricsWith>[0] = {}) => assessTechnical(metricsWith(overrides));

  it('RSI alone never establishes OVERSOLD', () => {
    expect(tech({ weeklyRsi: 10, weeklyRsiChange: -2, weeklyRsiSlope: -1, relativeStrengthChange: 0 }).result).toBe('NOT_ESTABLISHED');
    expect(tech({ weeklyRsi: 10, weeklyRsiChange: 0, weeklyRsiSlope: 0, relativeStrengthChange: -1 }).result).toBe('OVERSOLD');
  });

  it('relative strength Option A: STABILIZING needs change >= 0, RECOVERING needs change > 0', () => {
    expect(tech({ relativeStrengthChange: 0 }).result).toBe('STABILIZING');
    expect(tech({ relativeStrengthChange: 0.01 }).result).toBe('RECOVERING');
    expect(tech({ relativeStrengthChange: -0.01 }).result).not.toBe('STABILIZING');
    // a decelerating decline (-8 after -10) is still a deterioration: not eligible under "no longer deteriorating"
    expect(tech({ relativeStrengthChange: -8 }).result).toBe('NOT_ESTABLISHED');
  });

  it('DECLINING is evaluated first and needs two distinct bearish groups', () => {
    expect(tech({ weeklyRsi: 25, weeklyRsiChange: -2, weeklyRsiSlope: -1, price: 80 }).result).toBe('DECLINING');
    expect(tech({ weeklyRsi: 25, weeklyRsiChange: -2, weeklyRsiSlope: -1 }).result).toBe('NOT_ESTABLISHED');
  });

  it('NOT_ESTABLISHED is not an investment state: the four investment states are all that classify a candidate', () => {
    const states = ['DECLINING', 'OVERSOLD', 'STABILIZING', 'RECOVERING'];
    ['NOT_ESTABLISHED', 'NOT_EVALUABLE'].forEach((result) => expect(states).not.toContain(result));
  });
});

describe('A6 risk (ratified): UNKNOWN is nonblocking, never VERIFIED_EMPTY, never a WATCH cap', () => {
  it('unknown coverage: not VERIFIED_EMPTY, risk gate not PASS, classification identical to verified-empty (no WATCH cap)', () => {
    const unknown = evaluate({ eventFlags: unavailable('eventFlags') });
    const empty = evaluate({ eventFlags: [] });
    expect(assessRisk(metricsWith({ eventFlags: unavailable('eventFlags') }), context).eventCoverage).toBe('UNKNOWN');
    expect(gate(unknown, 'qv_risk')).toBe('NOT_EVALUABLE');
    expect(gate(empty, 'qv_risk')).toBe('PASS');
    expect(stateOf(unknown)).toBe('ACTIONABLE');
    expect(stateOf(unknown)).toBe(stateOf(empty));
  });

  it('earnings within 14 days is informational and non-disqualifying; a reliable event blocks', () => {
    const near = evaluate({ daysToEarnings: 14 });
    expect(stateOf(near)).toBe('ACTIONABLE');
    expect(codesOf(near)).toContain('RISK_EARNINGS_APPROACHING');
    expect(stateOf(evaluate({ eventFlags: ['TENDER_OFFER'] }))).toBe('WATCH');
  });
});

describe('A1-A8 ratification records', () => {
  it('every assumption is RATIFIED with a record; A7 stays a data limitation', () => {
    expect(QV_V1_0_ASSUMPTIONS.length).toBe(8);
    QV_V1_0_ASSUMPTIONS.forEach((a) => {
      expect(a.ratification).toBe('RATIFIED');
      expect(a.ratificationRecord).not.toBeNull();
    });
    expect(QV_V1_0_ASSUMPTIONS.find((a) => a.id === 'A7')?.basis).toBe('DATA');
  });
});

describe('A3 clarification (round 5): current TTM versus latest fiscal year', () => {
  const codes = (overrides: Parameters<typeof metricsWith>[0]) => assessFundamentals(metricsWith(overrides)).reasons.map((r) => r.code);

  it('TTM 1 with rising annual [10,20,30] is STABLE (not IMPROVING, not DETERIORATING) and emits explicit context', () => {
    expect(fcfTrajectory(1, [10, 20, 30])).toBe('STABLE');
    expect(fcfBelowLatestFiscalYear(1, [10, 20, 30])).toBe(true);
    const assessment = assessFundamentals(metricsWith({ fcf: 1, fcfHistory: [10, 20, 30] }));
    expect(assessment.dimensions.find((d) => d.dimension === 'FCF')?.state).toBe('STABLE');
    expect(assessment.reasons.map((r) => r.code)).toContain('FUNDAMENTAL_FCF_BELOW_LATEST_FY_CONTEXT');
  });

  it('TTM at or above the latest fiscal year keeps IMPROVING and emits no context', () => {
    expect(fcfTrajectory(35, [10, 20, 30])).toBe('IMPROVING');
    expect(fcfTrajectory(30, [10, 20, 30])).toBe('IMPROVING'); // not below the latest FY
    expect(fcfBelowLatestFiscalYear(30, [10, 20, 30])).toBe(false);
    expect(codes({ fcf: 35, fcfHistory: [10, 20, 30] })).not.toContain('FUNDAMENTAL_FCF_BELOW_LATEST_FY_CONTEXT');
    expect(codes({ fcf: 30, fcfHistory: [10, 20, 30] })).not.toContain('FUNDAMENTAL_FCF_BELOW_LATEST_FY_CONTEXT');
  });

  it('the guard is a level comparison only: it never makes DETERIORATING and never applies without a positive TTM or usable history', () => {
    expect(fcfTrajectory(1, [30, 20, 10])).toBe('STABLE');
    expect(fcfBelowLatestFiscalYear(1, null)).toBe(false);
    expect(fcfBelowLatestFiscalYear(1, [10, 20])).toBe(false);
    expect(fcfBelowLatestFiscalYear(0, [10, 20, 30])).toBe(false);
    expect(fcfBelowLatestFiscalYear(-1, [10, 20, 30])).toBe(false);
    expect(fcfBelowLatestFiscalYear(null, [10, 20, 30])).toBe(false);
  });

  it('TTM is still not an annual observation: persistence and level behavior from round 4 are unchanged', () => {
    expect(classifyFcfPattern(-1, [20, 10, -5])).toBe('DETERIORATING_INTO_NEGATIVE'); // one negative year; TTM not counted
    expect(classifyFcfPattern(-1, [5, 6, -5])).toBe('NEGATIVE_TEMPORARY');
    expect(classifyFcfPattern(-1, [5, -3, -2])).toBe('NEGATIVE_PERSISTENT');
    expect(classifyFcfPattern(1, [10, 20, 30])).toBe('POSITIVE'); // a collapsed positive TTM is still a POSITIVE level
    expect(classifyFcfPattern(0, null)).toBe('BREAKEVEN');
    expect(classifyFcfPattern(-1, null)).toBe('NOT_EVALUABLE');
    expect(fcfTrajectory(0, [30, 20, 10])).toBe('DETERIORATING');
    expect(fcfTrajectory(-1, [-5, 4, -2])).toBe('DETERIORATING');
    expect(assessQuality(metricsWith({ fcf: 1, fcfHistory: [10, 20, 30] })).result).toBe('PASS'); // Quality reads level only
  });
});
