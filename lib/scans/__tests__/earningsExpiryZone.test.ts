// lib/scans/__tests__/earningsExpiryZone.test.ts

// SCAN-ALIGN-0001D: Alan's fixture table. T = 2026-09-24 (Thu), asOf 2026-09-24T15:00:00Z,
// X = 2026-10-16 (Fri). Every row must give identical results under TZ=UTC and
// TZ=America/Los_Angeles (the classifier never uses host-local time).
import { describe, expect, it } from 'vitest';
import { classifyEarningsVsExpiry, earningsAfterExpiryTag, EARNINGS_AFTER_EXPIRY_WINDOW_BD } from '../earningsExpiryZone';

const ASOF = '2026-09-24T15:00:00Z';
const X = '2026-10-16';
const zone = (e: unknown, x: unknown = X, asOf: unknown = ASOF) => classifyEarningsVsExpiry(e, x, asOf);

describe('classifyEarningsVsExpiry: main table', () => {
  it.each([
    ['E = T-1', '2026-09-23', 'past', null],
    ['E = T', '2026-09-24', 'exclude', null],
    ['E between T and X', '2026-10-01', 'exclude', null],
    ['E = X', '2026-10-16', 'exclude', null],
    ['X+1 calendar (Saturday), N = 0', '2026-10-17', 'warn-after', 0],
    ['X+1bd', '2026-10-19', 'warn-after', 1],
    ['X+5bd', '2026-10-23', 'warn-after', 5],
    ['X+6bd', '2026-10-26', 'clear', null],
    ['weekend after window', '2026-10-24', 'clear', null],
    ['timestamp suffix uses the leading date', '2026-10-01T16:00:00Z', 'exclude', null],
  ])('%s', (_label, e, expectedZone, n) => {
    const r = zone(e);
    expect(r.zone).toBe(expectedZone);
    expect(r.businessDaysAfter).toBe(n);
  });

  it('the window is a named constant of 5 business days', () => { expect(EARNINGS_AFTER_EXPIRY_WINDOW_BD).toBe(5); });

  it('weekend crossing: X = 10-16, E = 10-23 is 5 business days, not 3', () => {
    expect(zone('2026-10-23').businessDaysAfter).toBe(5);
  });

  it('holiday-aware: Thanksgiving (X = 2026-11-20, E = 2026-11-30) warns at 5bd', () => {
    expect(zone('2026-11-30', '2026-11-20')).toMatchObject({ zone: 'warn-after', businessDaysAfter: 5 });
    expect(zone('2026-12-01', '2026-11-20').zone).toBe('clear');
  });

  it('holiday-aware: Good Friday (X = 2026-04-02, E = 2026-04-10) warns; 04-06 is 1bd', () => {
    expect(zone('2026-04-10', '2026-04-02', '2026-03-20T15:00:00Z')).toMatchObject({ zone: 'warn-after', businessDaysAfter: 5 });
    expect(zone('2026-04-06', '2026-04-02', '2026-03-20T15:00:00Z')).toMatchObject({ zone: 'warn-after', businessDaysAfter: 1 });
    expect(zone('2026-04-13', '2026-04-02', '2026-03-20T15:00:00Z').zone).toBe('clear');
  });
});

describe('classifyEarningsVsExpiry: New York "today"', () => {
  it('2026-10-02T01:00Z is 2026-10-01 21:00 ET: E = 10-01 is today, excluded', () => {
    expect(zone('2026-10-01', X, '2026-10-02T01:00:00Z')).toMatchObject({ zone: 'exclude', today: '2026-10-01' });
  });
  it('DST end: 2026-11-02T04:59Z is still 11-01 in New York (excluded), 05:00Z is 11-02 (past, silent)', () => {
    expect(zone('2026-11-01', '2026-11-20', '2026-11-02T04:59:00Z')).toMatchObject({ zone: 'exclude', today: '2026-11-01' });
    expect(zone('2026-11-01', '2026-11-20', '2026-11-02T05:00:00Z')).toMatchObject({ zone: 'past', today: '2026-11-02' });
  });
});

describe('classifyEarningsVsExpiry: malformed and missing inputs', () => {
  it.each([['2026-13-45'], [''], ['N/A'], ['2026-02-30'], [null], [undefined], [20261001]])('malformed E %j is no date (no exclusion)', (e) => {
    expect(zone(e).zone).toBe('no-date');
  });
  it('malformed or missing X is no gate', () => {
    expect(zone('2026-10-01', '2026-13-45').zone).toBe('no-gate');
    expect(zone('2026-10-01', null).zone).toBe('no-gate');
    expect(classifyEarningsVsExpiry('2026-10-01', undefined, ASOF).zone).toBe('no-gate');
  });
  it('missing asOf still excludes E <= X (fail toward exclusion) and flags the unknown T', () => {
    [null, undefined, '', 'garbage'].forEach(asOf => {
      expect(classifyEarningsVsExpiry('2026-10-01', X, asOf)).toMatchObject({ zone: 'exclude', asOfUnknown: true, today: null });
    });
  });
  it('a zoneless asOf datetime skips the lower bound (E < T cannot be established), still excludes E <= X', () => {
    expect(zone('2026-09-01', X, '2026-09-24T15:00:00')).toMatchObject({ zone: 'exclude', asOfUnknown: true });
  });
  it('missing asOf, E after expiry: warn-after still computed', () => {
    expect(classifyEarningsVsExpiry('2026-10-19', X, null)).toMatchObject({ zone: 'warn-after', businessDaysAfter: 1 });
  });
});

describe('earningsAfterExpiryTag', () => {
  it('N >= 1 shows business days; N = 0 says "after expiry", never "0 bd"', () => {
    expect(earningsAfterExpiryTag(1)).toBe('Earnings 1 bd after expiry');
    expect(earningsAfterExpiryTag(5)).toBe('Earnings 5 bd after expiry');
    expect(earningsAfterExpiryTag(0)).toBe('Earnings after expiry');
    expect(earningsAfterExpiryTag(0)).not.toMatch(/0 bd/);
    expect(earningsAfterExpiryTag(null)).toBe('Earnings after expiry');
  });
});
