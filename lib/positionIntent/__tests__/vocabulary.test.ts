// lib/positionIntent/__tests__/vocabulary.test.ts

import { describe, expect, it } from 'vitest';
import { INTENT_LABELS, intentFamilyFor, intentOptionsFor, isPositionIntent, normalizeIntentForFamily, POSITION_INTENT_VALUES } from '../vocabulary';

const leg = (direction: 'Long' | 'Short', optionType: 'C' | 'P') => ({ direction, optionType });

describe('intentFamilyFor', () => {
  it('a single long call with more than 120 days left is a LEAP, and stays one as it ages (bought at 392, now 356)', () => {
    expect(intentFamilyFor({ strategy: 'CALL', dte: 121, legs: [leg('Long', 'C')] })).toBe('LEAP');
    expect(intentFamilyFor({ strategy: 'CALL', dte: 356, legs: [leg('Long', 'C')] })).toBe('LEAP');
    expect(intentFamilyFor({ strategy: 'CALL', dte: 392, legs: [leg('Long', 'C')] })).toBe('LEAP');
  });
  it('a bought call with 120 days or fewer left, and any bought put, has no intent to choose', () => {
    expect(intentFamilyFor({ strategy: 'CALL', dte: 120, legs: [leg('Long', 'C')] })).toBeNull();
    expect(intentFamilyFor({ strategy: 'PUT', dte: 55, legs: [leg('Long', 'P')] })).toBeNull();
    expect(intentFamilyFor({ strategy: 'PUT', dte: 500, legs: [leg('Long', 'P')] })).toBeNull();
  });
  it('a lone short put or short call uses the income / acquire / wheel words', () => {
    expect(intentFamilyFor({ strategy: 'PUT', dte: 30, legs: [leg('Short', 'P')] })).toBe('SHORT_OPTION');
    expect(intentFamilyFor({ strategy: 'CALL', dte: 30, legs: [leg('Short', 'C')] })).toBe('SHORT_OPTION');
  });
  it('credit spreads and iron condors use the spread words; anything else has none', () => {
    const two = [leg('Short', 'P'), leg('Long', 'P')];
    expect(intentFamilyFor({ strategy: 'BPS', dte: 30, legs: two })).toBe('SPREAD');
    expect(intentFamilyFor({ strategy: 'BCS', dte: 30, legs: two })).toBe('SPREAD');
    expect(intentFamilyFor({ strategy: 'IC', dte: 30, legs: [...two, ...two] })).toBe('SPREAD');
    expect(intentFamilyFor({ strategy: 'UNKNOWN', dte: 30, legs: two })).toBeNull();
    expect(intentFamilyFor({ strategy: 'PUT', dte: 30, legs: [] })).toBeNull();
  });
});

describe('vocabularies never mix', () => {
  it('a LEAP never offers Income or Acquire; a short option never offers Hold or PMCC; every option has a label', () => {
    expect(intentOptionsFor('LEAP')).toEqual(['hold', 'pmcc', 'undecided']);
    expect(intentOptionsFor('SHORT_OPTION')).toEqual(['income', 'acquisition', 'wheel', 'neutral']);
    expect(intentOptionsFor('SPREAD')).toEqual(['income', 'neutral']);
    for (const family of ['LEAP', 'SHORT_OPTION', 'SPREAD'] as const) {
      for (const option of intentOptionsFor(family)) expect(INTENT_LABELS[option].length).toBeGreaterThan(0);
    }
  });
});

describe('normalizeIntentForFamily', () => {
  it('keeps a stored value that belongs to the vocabulary', () => {
    expect(normalizeIntentForFamily('wheel', 'SHORT_OPTION')).toBe('wheel');
    expect(normalizeIntentForFamily('pmcc', 'LEAP')).toBe('pmcc');
    expect(normalizeIntentForFamily('neutral', 'SPREAD')).toBe('neutral');
  });
  it('falls back safely when the stored value belongs to another vocabulary: LEAP to Undecided, the rest to Income', () => {
    expect(normalizeIntentForFamily('income', 'LEAP')).toBe('undecided');
    expect(normalizeIntentForFamily('acquisition', 'LEAP')).toBe('undecided');
    expect(normalizeIntentForFamily('hold', 'SHORT_OPTION')).toBe('income');
    expect(normalizeIntentForFamily('wheel', 'SPREAD')).toBe('income');
    expect(normalizeIntentForFamily(null, 'LEAP')).toBe('undecided');
    expect(normalizeIntentForFamily(undefined, 'SHORT_OPTION')).toBe('income');
  });
});

describe('isPositionIntent', () => {
  it('accepts exactly the known values', () => {
    for (const value of POSITION_INTENT_VALUES) expect(isPositionIntent(value)).toBe(true);
    expect(isPositionIntent('acquire')).toBe(false);
    expect(isPositionIntent(null)).toBe(false);
    expect(isPositionIntent(7)).toBe(false);
  });
});

describe('assignment weight for the newer engine', () => {
  it('a wheel prefers assignment like Acquire; income avoids it; the LEAP words and undecided are neutral', async () => {
    const { deriveAssignmentPreferenceFromIntent } = await import('@/lib/portfolio-intelligence/positionStrategyDefaults');
    expect(deriveAssignmentPreferenceFromIntent('wheel')).toBe('PREFER');
    expect(deriveAssignmentPreferenceFromIntent('acquisition')).toBe('PREFER');
    expect(deriveAssignmentPreferenceFromIntent('income')).toBe('AVOID');
    for (const value of ['hold', 'pmcc', 'undecided', 'neutral']) expect(deriveAssignmentPreferenceFromIntent(value)).toBe('ACCEPT');
  });
});
