// lib/discovery/qv/__tests__/policyExamples.test.ts

// LEAPS-QV-0001 Gate 3 review round 2 -- the worked examples in docs/analysis/LEAPS-QV-0001-gate3-policy-decisions.md.
// Each example shows the classification effect of a PROPOSED policy decision as the code behaves today, so the document
// cannot drift from the implementation. Nothing here is a ratified decision.

import { describe, expect, it } from 'vitest';
import { assessFundamentals, assessQuality, assessRisk, assessTechnical, growthTrajectoryOf, marginTrajectoryOf, classifyFcfPattern } from '..';
import { evaluate, metricsWith, stateOf } from './qvFixtures';

describe('policy decision examples (PROPOSED, not ratified)', () => {
  it('A1 revenue/EPS trajectory', () => {
    expect(growthTrajectoryOf(-2, 5)).toBe('DETERIORATING'); // negative and below trend
    expect(growthTrajectoryOf(1, 12)).toBe('STABLE'); // positive but far below trend: STABLE under the proposal (open question)
    expect(growthTrajectoryOf(3, 5)).toBe('STABLE');
    expect(growthTrajectoryOf(7, 5)).toBe('IMPROVING');
    expect(growthTrajectoryOf(-2, null)).toBe('DETERIORATING'); // adverse evidence stands without a trend
    expect(growthTrajectoryOf(4, null)).toBeNull(); // missing trend never establishes stability
  });

  it('A2 operating-margin trajectory band is +/- 1 percentage point', () => {
    expect([-1.01, -1, 0, 1, 1.01].map(marginTrajectoryOf)).toEqual(['DETERIORATING', 'STABLE', 'STABLE', 'STABLE', 'IMPROVING']);
  });

  it('A3 free-cash-flow patterns (TTM plus the last three fiscal years)', () => {
    expect(classifyFcfPattern(-1, [5, -1, 4])).toBe('NEGATIVE_TEMPORARY');
    expect(classifyFcfPattern(-1, [30, 20, 10])).toBe('DETERIORATING_INTO_NEGATIVE');
    expect(classifyFcfPattern(-1, [-5, -3, -2])).toBe('NEGATIVE_PERSISTENT');
    expect(classifyFcfPattern(-1, null)).toBe('NOT_EVALUABLE'); // no history: not guessed
  });

  it('A4 Quality composition: one weakness passes, two fail; HIGH leverage alone passes', () => {
    expect(assessQuality(metricsWith({ roic: 5 })).result).toBe('PASS');
    expect(assessQuality(metricsWith({ roic: 5, revenueCagr: -1 })).result).toBe('FAIL');
    expect(assessQuality(metricsWith({ leverage: 3.5 })).result).toBe('PASS');
    expect(assessQuality(metricsWith({ leverage: 3.5, roic: 5 })).result).toBe('FAIL');
    expect(assessQuality(metricsWith({ leverage: 2.5, roic: 5 })).result).toBe('PASS'); // ELEVATED leverage is not a weakness
  });

  it('A5 technical: OVERSOLD line, one contradiction, relative-strength change versus acceleration', () => {
    expect(assessTechnical(metricsWith({ weeklyRsi: 30, weeklyRsiSlope: -1 })).result).toBe('OVERSOLD');
    expect(assessTechnical(metricsWith({ weeklyRsi: 31, weeklyRsiSlope: -1 })).result).toBe('NOT_ESTABLISHED');
    // Relative strength falling more slowly (decelerating decline) is NOT eligible for STABILIZING under the strict
    // first-difference rule (change >= 0), although it would satisfy "deterioration no longer accelerating".
    expect(assessTechnical(metricsWith({ relativeStrengthChange: -3 })).result).toBe('NOT_ESTABLISHED');
  });

  it('A6 risk: earnings window and event flags', () => {
    const risk = (overrides: Parameters<typeof metricsWith>[0]) => assessRisk(metricsWith(overrides), { leverageBand: null, valuationConflict: false, deterioratingDimensions: 0 });
    expect(risk({ daysToEarnings: 14 }).earningsApproaching).toBe(true);
    expect(risk({ daysToEarnings: 15 }).earningsApproaching).toBe(false);
    expect(stateOf(evaluate({ daysToEarnings: 3 }))).toBe('ACTIONABLE'); // not disqualifying
    expect(stateOf(evaluate({ eventFlags: ['TENDER_OFFER'] }))).toBe('WATCH'); // blocks
  });

  it('A8 WATCH versus DISCOVERED', () => {
    expect(stateOf(evaluate({ percentile5y: 50, discount5y: 2 }))).toBe('WATCH'); // Quality PASS, thesis intact, valuation unmet
    expect(stateOf(evaluate({ margin: -3 }))).toBe('DISCOVERED'); // Quality FAIL
    expect(stateOf(evaluate({ revenueGrowth: -5, epsGrowth: -10 }))).toBe('DISCOVERED'); // growth-adjusted DETERIORATING
    expect(assessFundamentals(metricsWith({ revenueGrowth: -5, epsGrowth: -10 })).growthAdjusted).toBe('DETERIORATING');
    expect(stateOf(evaluate({ revenueGrowth: -5, epsGrowth: -10, marginChange: -3 }))).toBe('DISCOVERED'); // fresh thesis break
    expect(stateOf(evaluate({ revenueGrowth: -5, epsGrowth: -10, marginChange: -3 }, 'SETUP'))).toBe('INVALIDATED');
  });
});
