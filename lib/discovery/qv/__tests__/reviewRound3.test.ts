// lib/discovery/qv/__tests__/reviewRound3.test.ts

// LEAPS-QV-0001 Gate 3 review round 3 -- adverse trace is never erased, risk coverage is never promoted to PASS, state-specific
// evidence requirements, and the current behaviour behind the A1/A3 counterexamples (under review, NOT ratified).

import { describe, expect, it } from 'vitest';
import { assessRisk, assessTechnical, growthTrajectoryOf } from '..';
import { fcfTrajectory } from '../fcf';
import { codesOf, evaluate, metricsWith, stateOf, unavailable } from './qvFixtures';

const gate = (evaluation: ReturnType<typeof evaluate>, id: string) => evaluation.gateOutcomes.find((g) => g.gateId === id)?.result;

describe('adverse evidence is preserved when required data is missing', () => {
  it('missing level metric: state stays NOT_EVALUABLE / INSUFFICIENT_DATA but the adverse readings are reported', () => {
    const overrides = { sma200: unavailable('sma200'), price: 80, weeklyRsiChange: -3 } as Parameters<typeof metricsWith>[0];
    const assessment = assessTechnical(metricsWith(overrides));
    expect(assessment.result).toBe('NOT_EVALUABLE');
    expect(assessment.signals).toBeNull();
    const trace = assessment.reasons.find((r) => r.code === 'TECHNICAL_ADVERSE_EVIDENCE_PRESENT');
    expect(trace).toBeDefined();
    expect(JSON.stringify(trace)).toContain('PRICE_BELOW_SMA50');
    expect(JSON.stringify(trace)).toContain('RSI_4W_CHANGE_NEGATIVE');
    const evaluation = evaluate(overrides);
    expect(stateOf(evaluation)).toBe('INSUFFICIENT_DATA');
    expect(codesOf(evaluation)).toContain('TECHNICAL_ADVERSE_EVIDENCE_PRESENT');
  });

  it('no adverse reading, no trace', () => {
    const assessment = assessTechnical(metricsWith({ sma200: unavailable('sma200') } as Parameters<typeof metricsWith>[0]));
    expect(assessment.reasons.some((r) => r.code === 'TECHNICAL_ADVERSE_EVIDENCE_PRESENT')).toBe(false);
  });

  it('missing direction evidence: adverse trace accompanies the direction-unavailable reason', () => {
    const assessment = assessTechnical(metricsWith({ weeklyRsiSlope: null, relativeStrengthChange: null, weeklyRsiChange: 0, price: 80 }));
    const codes = assessment.reasons.map((r) => r.code);
    expect(codes).toContain('TECHNICAL_ADVERSE_EVIDENCE_PRESENT');
  });
});

describe('risk gate: unknown event coverage is not PASS', () => {
  const context = { leverageBand: null, valuationConflict: false, deterioratingDimensions: 0 } as const;

  it('coverage states', () => {
    expect(assessRisk(metricsWith({ eventFlags: [] }), context).eventCoverage).toBe('VERIFIED_EMPTY');
    expect(assessRisk(metricsWith({ eventFlags: ['SPINOFF'] }), context).eventCoverage).toBe('EVENTS_PRESENT');
    expect(assessRisk(metricsWith({ eventFlags: unavailable('eventFlags') }), context).eventCoverage).toBe('UNKNOWN');
  });

  it('gate outcome: PASS only when verified empty; NOT_EVALUABLE when unknown; FAIL when events present; classification unchanged', () => {
    const empty = evaluate({ eventFlags: [] });
    const unknown = evaluate({ eventFlags: unavailable('eventFlags') });
    const present = evaluate({ eventFlags: ['SPINOFF'] });
    expect(gate(empty, 'qv_risk')).toBe('PASS');
    expect(gate(unknown, 'qv_risk')).toBe('NOT_EVALUABLE');
    expect(gate(present, 'qv_risk')).toBe('FAIL');
    expect(stateOf(unknown)).toBe(stateOf(empty)); // nonblocking until a stricter amendment is accepted
    expect(stateOf(present)).not.toBe(stateOf(empty));
  });
});

describe('state-specific evidence requirements', () => {
  it('STABILIZING -> SETUP does not need the SMA50-gap change', () => {
    const evaluation = evaluate({ weeklyRsiSlope: 0, sma50GapChange: unavailable('sma50GapChange') });
    expect(stateOf(evaluation)).toBe('SETUP');
  });

  it('missing SMA50-gap change cannot reach ACTIONABLE (RECOVERING needs it)', () => {
    expect(stateOf(evaluate({ sma50GapChange: unavailable('sma50GapChange') }))).not.toBe('ACTIONABLE');
  });

  it('NOT_ESTABLISHED reaches WATCH only when Quality passes and the thesis is intact; otherwise DISCOVERED', () => {
    const notEstablished = { weeklyRsiChange: -3, weeklyRsiSlope: null, relativeStrengthChange: null } as Parameters<typeof metricsWith>[0];
    expect(assessTechnical(metricsWith(notEstablished)).result).toBe('NOT_ESTABLISHED');
    expect(stateOf(evaluate(notEstablished))).toBe('WATCH');
    expect(stateOf(evaluate({ ...notEstablished, margin: -5 } as Parameters<typeof metricsWith>[0]))).toBe('DISCOVERED');
  });

  it('OVERSOLD never passes WATCH', () => {
    expect(stateOf(evaluate({ weeklyRsi: 25, weeklyRsiChange: 0, weeklyRsiSlope: 0, relativeStrengthChange: -1 }))).toBe('WATCH');
  });
});

describe('A1/A3 counterexamples: CURRENT behaviour, documented for review (not ratified)', () => {
  it('A1: growth 1% vs trend 12% reads STABLE; contraction -2% vs -5% reads STABLE', () => {
    expect(growthTrajectoryOf(1, 12)).toBe('STABLE');
    expect(growthTrajectoryOf(-2, -5)).toBe('STABLE');
  });

  it('A3: overlapping latest-FY/TTM; TTM 1 with history [10,20,30] reads IMPROVING', () => {
    expect(fcfTrajectory(1, [10, 20, 30])).toBe('IMPROVING');
  });
});
