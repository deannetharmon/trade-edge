// lib/__tests__/optionSymbol.test.ts
// TE-0007C corrective round: canonical OCC-symbol parser regression tests.
import { describe, it, expect } from 'vitest';
import { parseOccSymbol, resolveOptionType, resolveUnderlyingSymbol } from '../optionSymbol';

describe('parseOccSymbol', () => {
  it('parses a tight (non-padded) OCC call symbol', () => {
    const parsed = parseOccSymbol('AAPL260918C00150000');
    expect(parsed.underlyingSymbol).toBe('AAPL');
    expect(parsed.optionType).toBe('C');
    expect(parsed.strikePrice).toBe(150);
    expect(parsed.expiry).toBe('2026-09-18');
  });

  it('parses a space-padded OCC put symbol (real TastyTrade format)', () => {
    const parsed = parseOccSymbol('MU    260918P00090000');
    expect(parsed.underlyingSymbol).toBe('MU');
    expect(parsed.optionType).toBe('P');
    expect(parsed.strikePrice).toBe(90);
  });

  it('returns all-null for an unparseable symbol, never a silent default', () => {
    const parsed = parseOccSymbol('not-a-valid-symbol');
    expect(parsed.underlyingSymbol).toBeNull();
    expect(parsed.optionType).toBeNull();
    expect(parsed.strikePrice).toBeNull();
    expect(parsed.expiry).toBeNull();
  });

  it('returns all-null for null/undefined/empty input', () => {
    expect(parseOccSymbol(null).optionType).toBeNull();
    expect(parseOccSymbol(undefined).optionType).toBeNull();
    expect(parseOccSymbol('').optionType).toBeNull();
  });
});

describe('resolveOptionType', () => {
  it('trusts a valid explicit option-type field over the symbol', () => {
    expect(resolveOptionType('C', 'AAPL260918P00150000')).toBe('C');
  });

  it('falls back to OCC-symbol parsing when the explicit field is absent', () => {
    expect(resolveOptionType(undefined, 'AAPL260918C00150000')).toBe('C');
    expect(resolveOptionType(null, 'AAPL260918P00150000')).toBe('P');
  });

  it('falls back to OCC-symbol parsing when the explicit field is invalid', () => {
    expect(resolveOptionType('bogus', 'AAPL260918C00150000')).toBe('C');
  });

  it('returns null (never a silent default) when neither source classifies', () => {
    expect(resolveOptionType(undefined, 'garbage')).toBeNull();
    expect(resolveOptionType(null, null)).toBeNull();
  });
});

describe('resolveUnderlyingSymbol', () => {
  it('trusts a verified underlying-symbol field over the OCC symbol', () => {
    expect(resolveUnderlyingSymbol('AAPL', 'MU260918C00150000')).toBe('AAPL');
  });

  it('falls back to the OCC symbol root when the explicit field is absent', () => {
    expect(resolveUnderlyingSymbol(undefined, 'AAPL260918C00150000')).toBe('AAPL');
  });

  it('returns null when neither source resolves', () => {
    expect(resolveUnderlyingSymbol(undefined, 'garbage')).toBeNull();
    expect(resolveUnderlyingSymbol('', null)).toBeNull();
  });
});
