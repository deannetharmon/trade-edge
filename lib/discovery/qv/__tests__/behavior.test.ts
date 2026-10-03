// lib/discovery/qv/__tests__/behavior.test.ts

// LEAPS-QV-0001 Gate 3 (Section 45.14) -- the 11 required behavioral cases.

import { describe, expect, it } from 'vitest';
import { advanceCandidate } from '../..';
import { createQvStrategyFor, QV_V1_0_STRATEGY, assessValuation } from '..';
import { ASOF, codesOf, DECLINING_TECH, evaluate, idOf, inputWith, metricsWith, OVERSOLD_TECH, STABILIZING_TECH, stateOf, THREE_DETERIORATING, unavailable } from './qvFixtures';
import { runStrategy } from '../..';

const NOT_QUALIFIED = ['DISCOVERED', 'WATCH', 'INSUFFICIENT_DATA', 'INVALIDATED'];

describe('Section 45.14 behavioral cases', () => {
  it('1. classic setup: Quality + discounted + intact fundamentals + STABILIZING => SETUP', () => {
    expect(stateOf(evaluate(STABILIZING_TECH))).toBe('SETUP');
  });

  it('2. recovery confirmed: same but RECOVERING => UNDERLYING ACTIONABLE', () => {
    const evaluation = evaluate();
    expect(stateOf(evaluation)).toBe('ACTIONABLE');
    expect(codesOf(evaluation)).toContain('TECHNICAL_RECOVERING');
  });

  it('3. falling knife: Quality + cheap + oversold/declining => WATCH', () => {
    const oversold = evaluate(OVERSOLD_TECH);
    expect(codesOf(oversold)).toContain('TECHNICAL_OVERSOLD');
    expect(stateOf(oversold)).toBe('WATCH');
    const declining = evaluate(DECLINING_TECH);
    expect(codesOf(declining)).toContain('TECHNICAL_DECLINING');
    expect(stateOf(declining)).toBe('WATCH');
  });

  it('4. value trap: extremely cheap + revenue/EPS/margin deteriorating => not SETUP/ACTIONABLE', () => {
    const overrides = { percentile5y: 3, discount5y: 40, ...THREE_DETERIORATING };
    const fresh = evaluate(overrides);
    expect(['SETUP', 'ACTIONABLE']).not.toContain(stateOf(fresh));
    expect(codesOf(fresh)).toContain('FUNDAMENTAL_THESIS_BROKEN');
  });

  it('5. expensive quality: excellent company + RECOVERING + no dislocation => DISCOVERED/WATCH', () => {
    const evaluation = evaluate({ percentile5y: 50, discount5y: 2 });
    expect(['DISCOVERED', 'WATCH']).toContain(stateOf(evaluation));
    expect(codesOf(evaluation)).toContain('VALUATION_NO_MATERIAL_DISLOCATION');
  });

  it('6. missing analyst revisions: still qualifies, with an explicit unavailable reason', () => {
    const evaluation = evaluate();
    expect(stateOf(evaluation)).toBe('ACTIONABLE');
    expect(codesOf(evaluation)).toContain('DATA_ANALYST_REVISION_DATA_UNAVAILABLE');
  });

  it('7. missing required evidence: cannot establish a required domain => INSUFFICIENT_DATA naming the blockers', () => {
    const evaluation = evaluate({ weeklyRsi: null });
    expect(evaluation.outcome).toEqual({ kind: 'INSUFFICIENT_DATA', missingMetricIds: [idOf('weeklyRsi')] });
    expect(codesOf(evaluation)).toContain('DATA_REQUIRED_DATA_UNAVAILABLE');
  });

  it('8. technical regression: ACTIONABLE -> STABILIZING while thesis intact => SETUP, not INVALIDATED', () => {
    const first = advanceCandidate(null, inputWith(), runStrategy(createQvStrategyFor(null), inputWith()));
    expect(first.record.state).toBe('ACTIONABLE');
    const stabilizing = inputWith(STABILIZING_TECH);
    const second = advanceCandidate(first.record, stabilizing, runStrategy(createQvStrategyFor(first.record.state), stabilizing));
    expect(second.record.state).toBe('SETUP');
    expect(second.record.state).not.toBe('INVALIDATED');
    const declining = inputWith(DECLINING_TECH);
    const third = advanceCandidate(second.record, declining, runStrategy(createQvStrategyFor(second.record.state), declining));
    expect(third.record.state).toBe('WATCH');
  });

  it('9. great company / tiny discount: percentile 45 + 5% discount + RECOVERING => not SETUP/ACTIONABLE', () => {
    expect(['SETUP', 'ACTIONABLE']).not.toContain(stateOf(evaluate({ percentile5y: 45, discount5y: 5 })));
  });

  it('10. unusual valuation without a large median discount: percentile 18 + 5% discount + Quality PASS + RECOVERING => STRONG', () => {
    const overrides = { percentile5y: 18, discount5y: 5 };
    expect(assessValuation(metricsWith(overrides)).result).toBe('STRONG');
    const evaluation = evaluate(overrides);
    expect(codesOf(evaluation)).toContain('VALUATION_DISLOCATION_STRONG');
    expect(stateOf(evaluation)).toBe('ACTIONABLE');
    expect(evaluation.riskFlags.map((flag) => flag.code)).toContain('RISK_VALUATION_CONFLICT');
  });

  it('11. cheap collapsing business: percentile 5 + 30% discount + three deteriorating dimensions => thesis break', () => {
    const overrides = { percentile5y: 5, discount5y: 30, ...THREE_DETERIORATING };
    const fresh = evaluate(overrides);
    expect(NOT_QUALIFIED).toContain(stateOf(fresh));
    expect(stateOf(fresh)).toBe('DISCOVERED'); // no prior thesis to invalidate
    expect(codesOf(fresh)).toEqual(expect.arrayContaining(['FUNDAMENTAL_THESIS_BROKEN', 'LIFECYCLE_THESIS_BREAK_NO_PRIOR_THESIS']));
    ['WATCH', 'SETUP', 'ACTIONABLE'].forEach((previous) => {
      expect(stateOf(evaluate(overrides, previous as 'WATCH'))).toBe('INVALIDATED');
    });
  });

  it('the registered strategy is stateless and runs through the Gate 1 contract', () => {
    const evaluation = runStrategy(QV_V1_0_STRATEGY, inputWith(STABILIZING_TECH));
    expect(evaluation.identity).toEqual({ strategyId: 'QV', strategyVersion: 'QV-v1.0' });
    expect(evaluation.evaluatedAt).toBe(ASOF);
    expect(stateOf(evaluation)).toBe('SETUP');
  });
});
