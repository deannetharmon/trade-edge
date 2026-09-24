// SCREENER-CONFIG-0001A -- field-level CSP validation. The rules are the ones the modal
// always enforced; these tests pin them and pin which field each message belongs to.

import { describe, it, expect } from 'vitest';
import { DEFAULT_CSP_RULES } from '@/lib/scans/constants';
import { cspFieldErrors, hasTargetedGate, isCspConfigValid } from '@/lib/screener/scanConfig/cspValidation';
import type { CspConfigValues } from '@/lib/screener/scanConfig/cspRegistry';

const base = (over: Partial<CspConfigValues> = {}): CspConfigValues => ({
  mode: 'rank', rules: { ...DEFAULT_CSP_RULES }, popMin: null, otmMin: null, rocMin: null,
  rankSecondary: 'none', affordableOnly: false, capitalLimit: null, ...over,
});
const rules = (patch: Partial<typeof DEFAULT_CSP_RULES>) => ({ ...DEFAULT_CSP_RULES, ...patch });

describe('cspFieldErrors', () => {
  it('the default configuration has no errors', () => {
    expect(cspFieldErrors(base())).toEqual({});
    expect(isCspConfigValid(base())).toBe(true);
  });

  it.each([
    ['DTE_MAX', { DTE_MIN: 45, DTE_MAX: 45 }],
    ['DTE_MIN', { DTE_MIN: -1 }],
    ['DELTA_MAX', { DELTA_MIN: 0.3, DELTA_MAX: 0.25 }],
    ['DELTA_MAX', { DELTA_MAX: 1.2 }],
    ['DELTA_MIN', { DELTA_MIN: -0.1 }],
    ['IVR_MAX', { IVR_MIN: 70, IVR_MAX: 70 }],
    ['IVR_MAX', { IVR_MAX: 101 }],
    ['IVR_MIN', { IVR_MIN: -5 }],
    ['OI_MIN', { OI_MIN: -1 }],
  ])('flags %s for %j', (field, patch) => {
    const errors = cspFieldErrors(base({ rules: rules(patch) }));
    expect(errors[field]).toBeTruthy();
    expect(isCspConfigValid(base({ rules: rules(patch) }))).toBe(false);
  });

  it('flags a non-numeric rule on its own field', () => {
    expect(cspFieldErrors(base({ rules: rules({ DTE_MIN: Number.NaN }) })).DTE_MIN).toBe('Enter a number.');
  });

  it('checks the Targeted minimums: POP 0 to 100, OTM and ROC 0 or more', () => {
    expect(cspFieldErrors(base({ popMin: 101 })).popMin).toBeTruthy();
    expect(cspFieldErrors(base({ popMin: -1 })).popMin).toBeTruthy();
    expect(cspFieldErrors(base({ popMin: 0 })).popMin).toBeUndefined();
    expect(cspFieldErrors(base({ popMin: 100 })).popMin).toBeUndefined();
    expect(cspFieldErrors(base({ otmMin: -0.1 })).otmMin).toBeTruthy();
    expect(cspFieldErrors(base({ rocMin: -1 })).rocMin).toBeTruthy();
  });

  it('checks the optional cash cap', () => {
    expect(cspFieldErrors(base({ capitalLimit: -5 })).capitalLimit).toBeTruthy();
    expect(cspFieldErrors(base({ capitalLimit: 8000 })).capitalLimit).toBeUndefined();
    expect(cspFieldErrors(base({ capitalLimit: null })).capitalLimit).toBeUndefined();
  });
});

describe('Targeted needs a gate', () => {
  it('a Targeted configuration with no POP, OTM, or ROC cannot run', () => {
    expect(hasTargetedGate(base({ mode: 'targeted' }))).toBe(false);
    expect(isCspConfigValid(base({ mode: 'targeted' }))).toBe(false);
  });

  it('any one of the three is enough', () => {
    expect(isCspConfigValid(base({ mode: 'targeted', popMin: 70 }))).toBe(true);
    expect(isCspConfigValid(base({ mode: 'targeted', otmMin: 8 }))).toBe(true);
    expect(isCspConfigValid(base({ mode: 'targeted', rocMin: 1.5 }))).toBe(true);
  });

  it('Rank never needs one', () => {
    expect(isCspConfigValid(base({ mode: 'rank' }))).toBe(true);
  });
});
