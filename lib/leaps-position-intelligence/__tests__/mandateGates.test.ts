// lib/leaps-position-intelligence/__tests__/mandateGates.test.ts
//
// LEAPS-MANDATE-0001. Worked example: GOOGL 250C held for $113.55 (breakeven $363.55), stock $350.86, candidate $375 call for $6.40.

import { describe, expect, it } from 'vitest';
import { applyMandateGates, describeIncomeRules, type MandateGateInput } from '../mandateGates';
import type { LeapsMandate } from '../types';

const mandate = (over: Partial<LeapsMandate> = {}): LeapsMandate => ({
  version: 'LEAPS-PI-1.1', thesis: '', invalidation: '', thesisTargetHigh: 390, invalidationPrice: null, posture: 'balanced',
  incomeCapStrike: null, minimumCycleCredit: null, allowKnownEarningsCycle: false, ...over,
});
const gates = (over: Partial<MandateGateInput> = {}) => applyMandateGates({
  mandate: mandate(), longStrike: 250, entryDebitPerShare: 113.55, stockPrice: 350.86, candidate: { strike: 375, credit: 6.4 }, earningsInWindow: null, ...over,
});
const c = (r: ReturnType<typeof gates>, id: string) => r.callouts.find(x => x.id === id);

describe('the worked example passes every rule', () => {
  const r = gates();
  it('is a review state with green callouts and the breakeven as the default floor', () => {
    expect(r.state).toBe('review-income-call');
    expect(r.reasonCode).toBeNull();
    expect(r.floor).toEqual({ strike: 363.55, source: 'breakeven' });
    expect(c(r, 'gate-income-floor')!.text).toBe('Short strike $375 is at or above your LEAPS breakeven $363.55.');
    expect(c(r, 'gate-upside-participation')!.text).toBe('The call keeps 62% of the way to your $390 target (needs 55%).');
    expect(r.participationPct).toBeCloseTo(61.7, 1);
    expect(r.participationRequiredPct).toBe(55);
  });
});

describe('income floor (Ian: breakeven by default)', () => {
  it('a strike one cent below the breakeven is refused even with no mandate at all', () => {
    const r = gates({ mandate: null, candidate: { strike: 363.54, credit: 6.4 } });
    expect(r).toMatchObject({ state: 'monitor', reasonCode: 'income-floor' });
    expect(c(r, 'gate-income-floor')).toMatchObject({ tone: 'bad', text: 'Short strike $363.54 is below your LEAPS breakeven $363.55: an assignment would lock in a loss.' });
  });
  it('exactly at the breakeven passes', () => {
    expect(gates({ mandate: null, candidate: { strike: 363.55, credit: 6.4 } }).state).toBe('review-income-call');
  });
  it('a saved income floor overrides the breakeven, in both directions', () => {
    expect(gates({ mandate: mandate({ incomeCapStrike: 380 }) })).toMatchObject({ state: 'monitor', reasonCode: 'income-floor', floor: { strike: 380, source: 'income-cap' } });
    expect(c(gates({ mandate: mandate({ incomeCapStrike: 380 }) }), 'gate-income-floor')!.text).toContain('below your income floor $380');
    expect(gates({ mandate: mandate({ incomeCapStrike: 360, thesisTargetHigh: null }), candidate: { strike: 362, credit: 6.4 } }).state).toBe('review-income-call');
  });
  it('with no entry cost and no saved floor there is no floor to enforce', () => {
    const r = gates({ mandate: null, entryDebitPerShare: null });
    expect(r.floor).toBeNull();
    expect(r.state).toBe('review-income-call');
  });
});

describe('earnings', () => {
  it('known earnings in the window block by default and when the mandate does not allow them', () => {
    for (const m of [null, mandate()]) {
      const r = gates({ mandate: m, earningsInWindow: '2026-10-01' });
      expect(r).toMatchObject({ state: 'monitor', reasonCode: 'known-event-blocked' });
    }
    expect(c(gates({ earningsInWindow: '2026-10-01' }), 'gate-known-event-blocked')!.text).toContain('Earnings on 2026-10-01');
  });
  it('a mandate that allows earnings lets the call through', () => {
    expect(gates({ mandate: mandate({ allowKnownEarningsCycle: true }), earningsInWindow: '2026-10-01' }).state).toBe('review-income-call');
  });
});

describe('minimum credit', () => {
  it.each([[6.4, 'review-income-call'], [6.5, 'monitor']])('credit 6.40 vs a %s minimum -> %s', (min, state) => {
    expect(gates({ mandate: mandate({ minimumCycleCredit: min }) }).state).toBe(state);
  });
  it('a minimum equal to the credit passes and is reported', () => {
    expect(c(gates({ mandate: mandate({ minimumCycleCredit: 6.4 }) }), 'gate-minimum-credit')!.tone).toBe('good');
  });
});

describe('upside participation (posture floors 70 / 55 / 40)', () => {
  // stock 350.86, target 390: strike 375 -> 61.7%; strike 360 -> 23.4%; strike 385 -> 92.3%
  it.each([['upside-first', 375, 'hold-uncovered'], ['balanced', 375, 'review-income-call'], ['income-first', 375, 'review-income-call'], ['balanced', 364, 'hold-uncovered'], ['income-first', 364, 'hold-uncovered'], ['upside-first', 385, 'review-income-call']] as const)(
    '%s posture, strike %s -> %s', (posture, strike, state) => {
      expect(gates({ mandate: mandate({ posture }), candidate: { strike, credit: 6.4 } }).state).toBe(state);
    });
  it('the failing message names the target and the requirement', () => {
    expect(c(gates({ mandate: mandate({ posture: 'upside-first' }) }), 'gate-upside-participation')!.text).toBe('The call leaves 62% of the way to your $390 target; your upside-first posture needs 70%.');
  });
  it('is not evaluated without a target, or with a target at or below the stock', () => {
    expect(gates({ mandate: mandate({ thesisTargetHigh: null }) }).participationPct).toBeNull();
    expect(gates({ mandate: mandate({ thesisTargetHigh: 350 }) }).participationPct).toBeNull();
    expect(gates({ mandate: mandate({ thesisTargetHigh: null }) }).state).toBe('review-income-call');
  });
  it('is clamped to 0-100', () => {
    expect(gates({ mandate: mandate({ posture: 'income-first' }), candidate: { strike: 500, credit: 6.4 } }).participationPct).toBe(100);
    expect(gates({ mandate: mandate({ posture: 'income-first', incomeCapStrike: 100 }), candidate: { strike: 300, credit: 6.4 } }).participationPct).toBe(0);
  });
});

describe('invalidation and precedence', () => {
  it.each([[351, 'reassess-thesis'], [350.86, 'reassess-thesis'], [350.85, 'review-income-call'], [300, 'review-income-call']])('stock 350.86 vs invalidation %s -> %s', (invalidationPrice, state) => {
    expect(gates({ mandate: mandate({ invalidationPrice }) }).state).toBe(state);
  });
  it('an invalidated thesis wins over every other failure', () => {
    const r = gates({ mandate: mandate({ invalidationPrice: 351, posture: 'upside-first' }), candidate: { strike: 360, credit: 1 }, earningsInWindow: '2026-10-01' });
    expect(r.state).toBe('reassess-thesis');
    expect(r.callouts.filter(x => x.tone === 'bad').length).toBeGreaterThanOrEqual(3); // every failing rule is still listed
  });
  it('known earnings win over income floor, which wins over participation', () => {
    const base = { mandate: mandate({ posture: 'upside-first' }), candidate: { strike: 360, credit: 6.4 } };
    expect(gates({ ...base, earningsInWindow: '2026-10-01' }).reasonCode).toBe('known-event-blocked');
    expect(gates(base).reasonCode).toBe('income-floor');
  });
});

describe('no candidate, no stock price', () => {
  it('without a candidate only the thesis rule can apply', () => {
    expect(gates({ candidate: null }).state).toBe('review-income-call');
    expect(gates({ candidate: null }).callouts).toEqual([]);
    expect(gates({ candidate: null, mandate: mandate({ invalidationPrice: 400 }) }).state).toBe('reassess-thesis');
  });
  it('without a stock price the participation and invalidation rules are skipped', () => {
    const r = gates({ stockPrice: null, mandate: mandate({ invalidationPrice: 400, posture: 'upside-first' }) });
    expect(r.state).toBe('review-income-call');
    expect(r.participationPct).toBeNull();
  });
  it('never mutates its input', () => {
    const input: MandateGateInput = { mandate: mandate(), longStrike: 250, entryDebitPerShare: 113.55, stockPrice: 350.86, candidate: { strike: 375, credit: 6.4 }, earningsInWindow: null };
    const before = JSON.stringify(input);
    applyMandateGates(input);
    expect(JSON.stringify(input)).toBe(before);
  });
});

describe('describeIncomeRules', () => {
  it('with no rules saved it states the defaults in force', () => {
    expect(describeIncomeRules(null, 363.55)).toBe('No income rules saved: floor $363.55 (your breakeven), and earnings before expiry block a call.');
    expect(describeIncomeRules(null, null)).toBe('No income rules saved: floor: needs your entry cost, and earnings before expiry block a call.');
  });
  it('summarises a saved mandate', () => {
    expect(describeIncomeRules(mandate({ incomeCapStrike: 365, minimumCycleCredit: 5, invalidationPrice: 300, allowKnownEarningsCycle: true }), 363.55))
      .toBe('Your rules: target $390 · floor $365 · balanced · earnings allowed · min credit $5 · invalidation $300');
    expect(describeIncomeRules(mandate({ thesisTargetHigh: null }), 363.55)).toBe('Your rules: no target set · floor $363.55 (your breakeven) · balanced · earnings not allowed');
  });
});
