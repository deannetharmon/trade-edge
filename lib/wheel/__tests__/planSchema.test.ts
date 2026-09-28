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

describe('the W2 check parameters', () => {
  it('are accepted as overrides, including the earnings rule', () => {
    const r = validatePlanPatch({ overrides: { hurdleBps: 1200, ivrEtf: 15, rsiMax: 75, earningsRule: 'wait', minShortDte: 10, openFeeCents: 100 } });
    expect(r.ok).toBe(true);
  });
  it.each([
    [{ earningsRule: 'never' }], [{ ivrEtf: 101 }], [{ rsiMax: -1 }], [{ minShortDte: 0 }], [{ minOpenInterest: 1.5 }], [{ openFeeCents: -5 }],
  ])('%j is rejected', (overrides) => {
    expect(validatePlanPatch({ overrides }).ok).toBe(false);
  });
});

describe('W3: historyWarnMarginBps', () => {
  it('is accepted as an override', () => {
    expect(validatePlanPatch({ overrides: { historyWarnMarginBps: 500 } }).ok).toBe(true);
  });
  it.each([[{ historyWarnMarginBps: -1 }], [{ historyWarnMarginBps: 10_001 }], [{ historyWarnMarginBps: 5.5 }]])('%j is rejected', (overrides) => {
    expect(validatePlanPatch({ overrides }).ok).toBe(false);
  });
  it('a bad stored value is dropped on read', () => {
    expect(parseStoredPlan(JSON.stringify({ overrides: { hurdleBps: 1200, earningsRule: 'sometimes', ivrStock: 500 } })).overrides).toEqual({ hurdleBps: 1200 });
  });
});

describe('the ETF or stock type on a list entry', () => {
  it('is kept only when it is etf or stock', () => {
    const plan = parseStoredPlan(JSON.stringify({ wheelList: [{ symbol: 'XLF', kind: 'etf' }, { symbol: 'NVDA', kind: 'stock' }, { symbol: 'AMZN', kind: 'fund' }] }));
    expect(plan.wheelList).toEqual([{ symbol: 'XLF', kind: 'etf' }, { symbol: 'NVDA', kind: 'stock' }, { symbol: 'AMZN' }]);
  });
});

describe('the per-name contract override', () => {
  it('is kept when it is a whole number from 1 to 100 and dropped otherwise', () => {
    const plan = parseStoredPlan(JSON.stringify({ wheelList: [
      { symbol: 'NVDA', contracts: 2 }, { symbol: 'AMZN', contracts: 0 }, { symbol: 'XLF', contracts: 1.5 }, { symbol: 'XLE', contracts: 101 }, { symbol: 'XLU', contracts: '3' },
    ] }));
    expect(plan.wheelList).toEqual([{ symbol: 'NVDA', contracts: 2 }, { symbol: 'AMZN' }, { symbol: 'XLF' }, { symbol: 'XLE' }, { symbol: 'XLU' }]);
  });
  it('is accepted on save', () => {
    expect(validatePlanPatch({ wheelList: [{ symbol: 'NVDA', contracts: 1 }] })).toMatchObject({ ok: true, wheelList: [{ symbol: 'NVDA', contracts: 1 }] });
  });
});

describe('sanitizeOverrides', () => {
  it('ignores non-objects and arrays', () => {
    expect(sanitizeOverrides(null)).toEqual({});
    expect(sanitizeOverrides([1, 2])).toEqual({});
    expect(sanitizeOverrides('x')).toEqual({});
  });
  it('rejects non-integers, out-of-range values and wrong types', () => {
    expect(sanitizeOverrides({ reserveBps: 10.5, spreadCapBps: 10_001, dropBps: '3000', deltaMinBps: 0, dteMin: -1 })).toEqual({});
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
    expect(validatePlanPatch({ overrides: { spreadCapBps: 2000, deltaMaxBps: 4000, dropBps: 1500 } }).ok).toBe(true);
  });
});
