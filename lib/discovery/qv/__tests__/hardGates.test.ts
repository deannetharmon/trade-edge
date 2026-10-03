// lib/discovery/qv/__tests__/hardGates.test.ts

// LEAPS-QV-0001 Gate 3 (Section 45.11) -- hard gates cannot be overridden; missing evidence is never neutral.

import { describe, expect, it } from 'vitest';
import { assessFundamentals, assessQuality, assessRisk } from '..';
import { codesOf, evaluate, idOf, invalid, metricsWith, stale, stateOf, STABILIZING_TECH, THREE_DETERIORATING, unavailable } from './qvFixtures';
import type { Field } from './qvFixtures';

const QUALIFIED = ['SETUP', 'ACTIONABLE'];
const EXTREME_VALUE = { percentile5y: 1, discount5y: 60 };

describe('hard gates', () => {
  it('extraordinary valuation cannot rescue failed Quality', () => {
    [{ margin: -5 }, { margin: 0 }, { leverage: 4, revenueCagr: -2 }, { roic: 3, revenueCagr: -1 }].forEach((fail) => {
      const evaluation = evaluate({ ...EXTREME_VALUE, ...fail });
      expect(QUALIFIED).not.toContain(stateOf(evaluation));
      expect(stateOf(evaluation)).toBe('DISCOVERED');
      expect(codesOf(evaluation)).toContain('LIFECYCLE_UNMET_QUALITY');
    });
  });

  it('known adverse Quality evidence stands even when other Quality inputs are missing', () => {
    const quality = assessQuality(metricsWith({ margin: -1, roic: null }));
    expect(quality.result).toBe('FAIL');
  });

  it('cheapness cannot rescue a broken thesis, and technical recovery cannot rescue broken fundamentals', () => {
    const evaluation = evaluate({ ...EXTREME_VALUE, ...THREE_DETERIORATING }, 'ACTIONABLE'); // RECOVERING technicals
    expect(stateOf(evaluation)).toBe('INVALIDATED');
    expect(QUALIFIED).not.toContain(stateOf(evaluate({ ...EXTREME_VALUE, ...THREE_DETERIORATING })));
  });

  it('two deteriorating dimensions is DETERIORATING growth-adjusted (blocks SETUP/ACTIONABLE) but not a thesis break', () => {
    const overrides = { revenueGrowth: -5, epsGrowth: -10 };
    const fundamentals = assessFundamentals(metricsWith(overrides));
    expect(fundamentals.growthAdjusted).toBe('DETERIORATING');
    expect(fundamentals.thesisBroken).toBe(false);
    expect(stateOf(evaluate(overrides, 'ACTIONABLE'))).toBe('DISCOVERED');
  });

  it('one deteriorating dimension is MIXED and still qualifies; a single weak quarter does not break the thesis', () => {
    const fundamentals = assessFundamentals(metricsWith({ epsGrowth: -10 }));
    expect(fundamentals.growthAdjusted).toBe('MIXED');
    expect(stateOf(evaluate({ epsGrowth: -10 }))).toBe('ACTIONABLE');
  });

  it('missing, stale or invalid required evidence is INSUFFICIENT_DATA and is never compensated by strength elsewhere', () => {
    const required: Field[] = ['pe', 'margin', 'roic', 'leverage', 'revenueCagr', 'weeklyRsi', 'sma200', 'revenueGrowth', 'epsGrowth', 'marginChange'];
    required.forEach((field) => {
      [null, unavailable(field), stale(field), invalid(field)].forEach((state) => {
        const evaluation = evaluate({ ...EXTREME_VALUE, [field]: state });
        expect(stateOf(evaluation), `${field} ${state === null ? 'absent' : state.validity}`).toBe('INSUFFICIENT_DATA');
      });
    });
  });

  it('a STALE metric never exposes its stale value to a decision', () => {
    const evaluation = evaluate({ weeklyRsiChange: stale('weeklyRsiChange', 5) });
    expect(stateOf(evaluation)).toBe('INSUFFICIENT_DATA');
    expect(evaluation.outcome.kind === 'INSUFFICIENT_DATA' && evaluation.outcome.missingMetricIds).toContain(idOf('weeklyRsiChange'));
  });

  it('negative TTM free cash flow without annual history is INSUFFICIENT_DATA, not a guess (data limitation)', () => {
    expect(stateOf(evaluate({ fcf: -1 }))).toBe('INSUFFICIENT_DATA');
  });

  it('negative FCF is classified from history: temporary does not fail Quality; deteriorating plus weak ROIC does', () => {
    expect(assessQuality(metricsWith({ fcf: -1, fcfHistory: [5, -1, 4] })).fcfPattern).toBe('NEGATIVE_TEMPORARY');
    expect(assessQuality(metricsWith({ fcf: -1, fcfHistory: [5, -1, 4] })).result).toBe('PASS');
    const deteriorating = assessQuality(metricsWith({ fcf: -1, fcfHistory: [30, 20, 10], roic: 5 }));
    expect(deteriorating.fcfPattern).toBe('DETERIORATING_INTO_NEGATIVE');
    expect(deteriorating.result).toBe('FAIL');
    expect(assessQuality(metricsWith({ fcf: -1, fcfHistory: [-5, -3, -2] })).fcfPattern).toBe('NEGATIVE_PERSISTENT');
  });

  it('HIGH leverage plus one other weakness fails Quality; HIGH leverage alone does not', () => {
    expect(assessQuality(metricsWith({ leverage: 3.5 })).result).toBe('PASS');
    expect(assessQuality(metricsWith({ leverage: 3.5, roic: 5 })).result).toBe('FAIL');
  });

  it('a technical-only regression can never invalidate', () => {
    ['ACTIONABLE', 'SETUP', 'WATCH'].forEach((previous) => {
      [STABILIZING_TECH, { weeklyRsi: 20, weeklyRsiChange: -3, price: 60 }].forEach((tech) => {
        expect(stateOf(evaluate(tech, previous as 'WATCH'))).not.toBe('INVALIDATED');
      });
    });
  });

  it('optional analyst revisions never block, and are never a neutral score', () => {
    const evaluation = evaluate();
    expect(stateOf(evaluation)).toBe('ACTIONABLE');
    expect(evaluation.rankings).toEqual({});
  });

  it('risk: ordinary earnings proximity is a flag, never a disqualifier; a reliable binary event blocks', () => {
    const near = evaluate({ daysToEarnings: 7 });
    expect(stateOf(near)).toBe('ACTIONABLE');
    expect(near.riskFlags.map((f) => f.code)).toContain('RISK_EARNINGS_APPROACHING');
    const event = evaluate({ eventFlags: ['MERGER_PENDING'] });
    expect(stateOf(event)).toBe('WATCH');
    expect(codesOf(event)).toContain('LIFECYCLE_UNMET_RISK');
  });

  it('risk: missing event data stays explicitly unavailable, never "no events"', () => {
    const risk = assessRisk(metricsWith({ eventFlags: null, daysToEarnings: null }), { leverageBand: null, valuationConflict: false, deterioratingDimensions: 0 });
    expect(risk.binaryEventPending).toBe(false);
    expect(risk.reasons.length).toBeGreaterThanOrEqual(2);
    expect(risk.reasons.every((reason) => reason.category === 'DATA')).toBe(true);
  });

  it('the FCF/leverage dimension limitations are reported, never counted as stable', () => {
    const fundamentals = assessFundamentals(metricsWith({}));
    expect(fundamentals.dimensions.find((d) => d.dimension === 'LEVERAGE')?.state).toBe('NOT_EVALUABLE');
    expect(fundamentals.reasons.map((r) => r.code)).toContain('DATA_LEVERAGE_TRAJECTORY_UNAVAILABLE');
  });
});
