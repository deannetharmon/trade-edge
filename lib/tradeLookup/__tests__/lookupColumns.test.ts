// lib/tradeLookup/__tests__/lookupColumns.test.ts
// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_LOOKUP_COLUMNS, LOOKUP_COLUMNS, LOOKUP_COLUMNS_STORAGE_KEY, loadLookupColumns, sanitizeLookupColumns, toggleLookupColumn,
} from '../lookupColumns';

describe('lookup columns', () => {
  it('max risk is hidden by default and everything else useful is shown', () => {
    expect(DEFAULT_LOOKUP_COLUMNS).not.toContain('maxRisk');
    expect(DEFAULT_LOOKUP_COLUMNS).toContain('pop');
    expect(DEFAULT_LOOKUP_COLUMNS).toContain('flags');
  });
  it('sanitize drops unknown ids, keeps table order, always keeps strike', () => {
    expect(sanitizeLookupColumns(['pop', 'bogus', 'delta'])).toEqual(['strike', 'delta', 'pop']);
  });
  it('sanitize falls back to the default on junk or a near-empty list', () => {
    expect(sanitizeLookupColumns(null)).toEqual(DEFAULT_LOOKUP_COLUMNS);
    expect(sanitizeLookupColumns('x')).toEqual(DEFAULT_LOOKUP_COLUMNS);
    expect(sanitizeLookupColumns([])).toEqual(DEFAULT_LOOKUP_COLUMNS);
  });
  it('toggle adds and removes, never removes strike, never goes below two columns', () => {
    const withRisk = toggleLookupColumn(DEFAULT_LOOKUP_COLUMNS, 'maxRisk');
    expect(withRisk).toContain('maxRisk');
    expect(toggleLookupColumn(withRisk, 'maxRisk')).not.toContain('maxRisk');
    expect(toggleLookupColumn(DEFAULT_LOOKUP_COLUMNS, 'strike')).toEqual(DEFAULT_LOOKUP_COLUMNS);
    expect(toggleLookupColumn(['strike', 'pop'], 'pop')).toEqual(DEFAULT_LOOKUP_COLUMNS);
  });
  it('every column has a label and group', () => {
    for (const c of LOOKUP_COLUMNS) { expect(c.label).toBeTruthy(); expect(c.group).toBeTruthy(); }
  });
});

describe('loadLookupColumns', () => {
  beforeEach(() => { window.localStorage.clear(); });
  it('reads a saved choice and survives bad stored data', () => {
    window.localStorage.setItem(LOOKUP_COLUMNS_STORAGE_KEY, JSON.stringify(['strike', 'maxRisk']));
    expect(loadLookupColumns()).toEqual(['strike', 'maxRisk']);
    window.localStorage.setItem(LOOKUP_COLUMNS_STORAGE_KEY, '{not json');
    expect(loadLookupColumns()).toEqual(DEFAULT_LOOKUP_COLUMNS);
  });
});
