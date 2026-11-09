// lib/ccBasis/__tests__/ccBasisSettings.test.ts
// CC-WHEEL-0001 S2a -- typed cost basis and per-position opt-in.
import { describe, it, expect } from 'vitest';
import { applyTypedBasis, resolveCcBasis, sanitizeCcBasisSettings, normalizeCcBasisSymbol } from '../ccBasisSettings';
import { computeCoveredCallCapacity } from '@/lib/scans/covered-call-capacity';

describe('sanitizeCcBasisSettings', () => {
  it('keeps valid entries and uppercases symbols', () => {
    expect(sanitizeCcBasisSettings({ tqqq: { basis: 82, allowBelowBasis: true } })).toEqual({ TQQQ: { basis: 82, allowBelowBasis: true } });
  });
  it('drops bad bases, keeping an opt-in with no basis', () => {
    expect(sanitizeCcBasisSettings({ A: { basis: -1 }, B: { basis: 0 }, C: { basis: 'x' }, D: { basis: Number.NaN }, E: { basis: null, allowBelowBasis: true } }))
      .toEqual({ E: { basis: null, allowBelowBasis: true } });
  });
  it('treats only a literal true as opt-in', () => {
    expect(sanitizeCcBasisSettings({ A: { basis: 10, allowBelowBasis: 'true' } })).toEqual({ A: { basis: 10, allowBelowBasis: false } });
  });
  it('drops entries that say nothing, bad symbols, and non-objects', () => {
    expect(sanitizeCcBasisSettings({ A: { basis: null, allowBelowBasis: false }, 'BAD SYMBOL!': { basis: 5 }, B: 7, C: null })).toEqual({});
    expect(sanitizeCcBasisSettings(null)).toEqual({});
    expect(sanitizeCcBasisSettings([1, 2])).toEqual({});
    expect(sanitizeCcBasisSettings('x')).toEqual({});
  });
  it('caps the number of entries', () => {
    const many: Record<string, unknown> = {};
    for (let i = 0; i < 300; i++) many[`S${i}`] = { basis: 10, allowBelowBasis: false };
    expect(Object.keys(sanitizeCcBasisSettings(many)).length).toBe(200);
  });
  it('rounds to four decimals and rejects absurd values', () => {
    expect(sanitizeCcBasisSettings({ A: { basis: 76.123456 } }).A.basis).toBe(76.1235);
    expect(sanitizeCcBasisSettings({ A: { basis: 5_000_000 } })).toEqual({});
  });
});

describe('normalizeCcBasisSymbol', () => {
  it('trims and uppercases, rejects empties and junk', () => {
    expect(normalizeCcBasisSymbol(' tqqq ')).toBe('TQQQ');
    expect(normalizeCcBasisSymbol('')).toBeNull();
    expect(normalizeCcBasisSymbol(5)).toBeNull();
    expect(normalizeCcBasisSymbol('A'.repeat(13))).toBeNull();
  });
});

describe('resolveCcBasis / applyTypedBasis', () => {
  const brokerCap = computeCoveredCallCapacity(100, 0, 0, 80);
  const unknownCap = computeCoveredCallCapacity(100, 0, 0, null);
  const settings = sanitizeCcBasisSettings({ TQQQ: { basis: 76.5, allowBelowBasis: false } });

  it('typed beats broker, and says so', () => {
    expect(resolveCcBasis(settings, 'tqqq', brokerCap)).toEqual({ basis: 76.5, source: 'typed', allowBelowBasis: false });
    const applied = applyTypedBasis(settings, 'TQQQ', brokerCap);
    expect(applied.costBasis).toBe(76.5);
    expect(applied.costBasisComplete).toBe(true);
  });
  it('typed fills an unknown broker basis', () => {
    expect(applyTypedBasis(settings, 'TQQQ', unknownCap).costBasis).toBe(76.5);
  });
  it('with nothing typed the broker basis is used, labeled broker', () => {
    expect(resolveCcBasis({}, 'TQQQ', brokerCap)).toEqual({ basis: 80, source: 'broker', allowBelowBasis: false });
    expect(applyTypedBasis({}, 'TQQQ', brokerCap)).toBe(brokerCap);
  });
  it('with nothing typed and no broker basis there is no basis', () => {
    expect(resolveCcBasis({}, 'TQQQ', unknownCap)).toEqual({ basis: null, source: null, allowBelowBasis: false });
    expect(applyTypedBasis({}, 'TQQQ', unknownCap).costBasis).toBeNull();
  });
  it('an incomplete broker basis is not used', () => {
    const partial = computeCoveredCallCapacity(100, 0, 0, 80, false);
    expect(resolveCcBasis({}, 'TQQQ', partial).basis).toBeNull();
  });
  it('an opt-in alone does not create a basis', () => {
    const optIn = sanitizeCcBasisSettings({ TQQQ: { basis: null, allowBelowBasis: true } });
    expect(resolveCcBasis(optIn, 'TQQQ', unknownCap)).toEqual({ basis: null, source: null, allowBelowBasis: true });
    expect(applyTypedBasis(optIn, 'TQQQ', unknownCap).costBasis).toBeNull();
  });
  it('does not touch share counts or calls, and does not leak to other symbols', () => {
    const cap = computeCoveredCallCapacity(300, 1, 1, 80);
    const applied = applyTypedBasis(settings, 'TQQQ', cap);
    expect(applied.availableCoveredContracts).toBe(cap.availableCoveredContracts);
    expect(applied.sharesOwned).toBe(300);
    expect(applyTypedBasis(settings, 'SOXL', cap)).toBe(cap);
  });
});

describe('adjusted basis precedence (S5)', () => {
  const cap = { costBasis: 78.75, costBasisComplete: true, sharesOwned: 200 } as never;
  it('typed beats adjusted beats broker', () => {
    expect(resolveCcBasis({ TQQQ: { basis: 70, allowBelowBasis: false } }, 'TQQQ', cap, 74.95)).toMatchObject({ basis: 70, source: 'typed' });
    expect(resolveCcBasis({}, 'TQQQ', cap, 74.95)).toMatchObject({ basis: 74.95, source: 'adjusted' });
    expect(resolveCcBasis({}, 'TQQQ', cap, null)).toMatchObject({ basis: 78.75, source: 'broker' });
  });
  it('the adjusted basis overlays the capacity the scan uses', () => {
    expect(applyTypedBasis({}, 'TQQQ', cap, 74.95)).toMatchObject({ costBasis: 74.95, costBasisComplete: true });
    expect(applyTypedBasis({}, 'TQQQ', cap, null)).toBe(cap);
  });
});
