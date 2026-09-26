// lib/wheel/__tests__/planSchema.test.ts
//
// WHEEL-SYSTEM-0001 (W1) -- the saved plan: safe reading of stored data and strict validation of saves.

import { describe, expect, it } from 'vitest';
import { emptyPlan, parseStoredPlan, sanitizeOverrides, validatePlanPatch } from '../planSchema';

describe('parseStoredPlan never throws', () => {
  it('returns the defaults for nothing stored', () => {
    expect(parseStoredPlan(null)).toEqual(emptyPlan());
    expect(parseStoredPlan(undefined)).toEqual(emptyPlan());
    expect(parseStoredPlan('')).toEqual(emptyPlan());
  });
  it('returns the defaults for malformed JSON and for non-objects', () => {
    expect(parseStoredPlan('{not json')).toEqual(emptyPlan());
    expect(parseStoredPlan('null')).toEqual(emptyPlan());
    expect(parseStoredPlan('42')).toEqual(emptyPlan());
  });
  it('keeps the good fields and drops the bad ones, field by field', () => {
    const plan = parseStoredPlan(JSON.stringify({
      overrides: { reserveBps: 500, profile: 'nonsense', unknownKey: 1, dropBps: 0, accountCents: 6_000_000 },
      wheelList: [{ symbol: 'xlf' }, { symbol: 'XLF' }, { symbol: 'bad symbol!' }, 7, { symbol: 'XLE', sector: ' Energy ', dropBps: 3500 }],
      updatedAt: '2026-09-26T00:00:00.000Z',
    }));
    expect(plan.overrides).toEqual({ reserveBps: 500, accountCents: 6_000_000 });
    expect(plan.wheelList).toEqual([{ symbol: 'XLF' }, { symbol: 'XLE', sector: 'Energy', dropBps: 3500 }]);
    expect(plan.updatedAt).toBe('2026-09-26T00:00:00.000Z');
  });
});

describe('sanitizeOverrides', () => {
  it('ignores non-objects and arrays', () => {
    expect(sanitizeOverrides(null)).toEqual({});
    expect(sanitizeOverrides([1, 2])).toEqual({});
    expect(sanitizeOverrides('x')).toEqual({});
  });
  it('rejects non-integers, out-of-range values and wrong types', () => {
    expect(sanitizeOverrides({ reserveBps: 10.5, spreadCapBps: 10_001, dropBps: '3000', targetDeltaBps: 0, dteMin: -1 })).toEqual({});
  });
});

describe('validatePlanPatch', () => {
  it('accepts a partial overrides object and a list', () => {
    const r = validatePlanPatch({ overrides: { reserveBps: 500 }, wheelList: [{ symbol: 'XLF' }, { symbol: 'XLE', sector: 'Energy' }] });
    expect(r.ok).toBe(true);
    expect(r.overrides).toEqual({ reserveBps: 500 });
    expect(r.wheelList).toEqual([{ symbol: 'XLF' }, { symbol: 'XLE', sector: 'Energy' }]);
  });
  it('accepts an empty overrides object (reset to defaults) and an empty list', () => {
    const r = validatePlanPatch({ overrides: {}, wheelList: [] });
    expect(r).toMatchObject({ ok: true, overrides: {}, wheelList: [] });
  });
  it('a part that is absent stays absent (the route keeps what is stored)', () => {
    const r = validatePlanPatch({ wheelList: [{ symbol: 'XLF' }] });
    expect(r.ok).toBe(true);
    expect(r.overrides).toBeUndefined();
  });
  it.each([
    [null], [[]], ['x'], [{ unknown: 1 }],
    [{ overrides: [] }], [{ overrides: { nope: 1 } }], [{ overrides: { reserveBps: '500' } }], [{ overrides: { reserveBps: 1.5 } }],
    [{ wheelList: 'XLF' }], [{ wheelList: [{ symbol: 'XLF' }, { symbol: 'XLF' }] }], [{ wheelList: [{ symbol: '' }] }],
    [{ wheelList: Array.from({ length: 41 }, (_, i) => ({ symbol: `A${i}` })) }],
  ])('rejects %j', (body) => {
    expect(validatePlanPatch(body).ok).toBe(false);
  });
  it('a combined value that breaks the math is rejected (reserve plus spread cap above 100%)', () => {
    const r = validatePlanPatch({ overrides: { reserveBps: 6000, spreadCapBps: 5000 } });
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/100%/);
  });
  it('a merely unusual value is saved (soft warnings never block)', () => {
    expect(validatePlanPatch({ overrides: { spreadCapBps: 2000, targetDeltaBps: 4000, dropBps: 1500 } }).ok).toBe(true);
  });
});
