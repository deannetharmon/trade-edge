// lib/leaps-position-intelligence/__tests__/mandate.test.ts
import { describe, expect, it } from 'vitest';
import { MANDATE_TEXT_MAX, validateMandateInput } from '../mandate';

const ok = (raw: unknown) => { const r = validateMandateInput(raw); if (!r.ok) throw new Error(r.errors.join('; ')); return r.mandate; };
const errors = (raw: unknown) => { const r = validateMandateInput(raw); return r.ok ? [] : r.errors; };

describe('validateMandateInput', () => {
  it('accepts the quick setup and fills the rest with safe defaults', () => {
    expect(ok({ thesisTargetHigh: 390, incomeCapStrike: 363.55, allowKnownEarningsCycle: false })).toEqual({
      version: 'LEAPS-PI-1.1', thesis: '', invalidation: '', thesisTargetHigh: 390, invalidationPrice: null, posture: 'balanced',
      incomeCapStrike: 363.55, minimumCycleCredit: null, allowKnownEarningsCycle: false,
    });
  });

  it('an empty object is a valid "no rules yet beyond defaults" mandate (balanced, earnings not allowed)', () => {
    expect(ok({})).toMatchObject({ posture: 'balanced', allowKnownEarningsCycle: false, thesisTargetHigh: null, incomeCapStrike: null });
  });

  it('accepts numeric strings from a form and trims text', () => {
    expect(ok({ thesisTargetHigh: ' 390 ', invalidationPrice: '300', thesis: '  AI capex  ' })).toMatchObject({ thesisTargetHigh: 390, invalidationPrice: 300, thesis: 'AI capex' });
  });

  it('drops unknown fields and never trusts a client-supplied version', () => {
    const m = ok({ version: 'other', hacked: true, posture: 'income-first' }) as unknown as Record<string, unknown>;
    expect(m.version).toBe('LEAPS-PI-1.1');
    expect('hacked' in m).toBe(false);
  });

  it.each([
    [{ thesisTargetHigh: -5 }, 'Target price must be a positive number.'],
    [{ thesisTargetHigh: 0 }, 'Target price must be a positive number.'],
    [{ thesisTargetHigh: 'abc' }, 'Target price must be a positive number.'],
    [{ incomeCapStrike: Infinity }, 'Income floor strike must be a positive number.'],
    [{ invalidationPrice: Number.NaN }, 'Invalidation price must be a positive number.'],
    [{ minimumCycleCredit: -1 }, 'Minimum credit must be a non-negative number.'],
    [{ posture: 'yolo' }, 'Posture must be upside-first, balanced, or income-first.'],
    [{ allowKnownEarningsCycle: 'yes' }, 'Allow earnings must be yes or no.'],
    [{ thesis: 42 }, 'Thesis must be text.'],
    [{ thesis: 'x'.repeat(MANDATE_TEXT_MAX + 1) }, `Thesis is limited to ${MANDATE_TEXT_MAX} characters.`],
    [{ thesisTargetHigh: 300, invalidationPrice: 300 }, 'Invalidation price must be below the target price.'],
    [{ thesisTargetHigh: 300, invalidationPrice: 350 }, 'Invalidation price must be below the target price.'],
  ])('rejects %j', (raw, message) => {
    expect(errors(raw)).toContain(message);
  });

  it('a minimum credit of zero is allowed; the boundary of exactly the text limit is allowed', () => {
    expect(ok({ minimumCycleCredit: 0 }).minimumCycleCredit).toBe(0);
    expect(ok({ thesis: 'x'.repeat(MANDATE_TEXT_MAX) }).thesis).toHaveLength(MANDATE_TEXT_MAX);
  });

  it.each([[null], [undefined], ['text'], [7], [[]]])('rejects a non-object: %j', raw => {
    expect(errors(raw)).toEqual(['A mandate object is required.']);
  });

  it('reports every problem at once', () => {
    expect(errors({ thesisTargetHigh: -1, posture: 'x', allowKnownEarningsCycle: 3 }).length).toBe(3);
  });
});
