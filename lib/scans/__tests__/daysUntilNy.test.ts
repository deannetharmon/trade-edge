// lib/scans/__tests__/daysUntilNy.test.ts

import { describe, expect, it } from 'vitest';
import { calendarDaysBetween, daysUntilNy } from '../earningsPrecheck';

const cases: Array<[string, string, string, number]> = [
  ['summer 13:00Z', '2026-09-24', '2026-09-24T13:00Z', 0],
  ['summer 21:00Z', '2026-09-24', '2026-09-24T21:00Z', 0],
  ['summer 23:30 ET', '2026-09-24', '2026-09-25T03:30Z', 0],
  ['summer midnight ET next day', '2026-09-24', '2026-09-25T04:00Z', -1],
  ['summer day before 23:59 ET', '2026-09-24', '2026-09-24T03:59Z', 1],
  ['NY date string same day', '2026-09-24', '2026-09-24', 0],
  ['NY date string next day', '2026-09-24', '2026-09-25', -1],
  ['winter 14:00Z', '2026-12-15', '2026-12-15T14:00Z', 0],
  ['winter 22:00Z', '2026-12-15', '2026-12-15T22:00Z', 0],
  ['winter 04:30Z next', '2026-12-15', '2026-12-16T04:30Z', 0],
  ['winter 05:00Z next', '2026-12-15', '2026-12-16T05:00Z', -1],
  ['spring DST 06:59Z', '2026-03-08', '2026-03-08T06:59Z', 0],
  ['spring DST 07:00Z', '2026-03-08', '2026-03-08T07:00Z', 0],
  ['spring DST 03-09 03:59Z', '2026-03-08', '2026-03-09T03:59Z', 0],
  ['spring DST 03-09 04:00Z', '2026-03-08', '2026-03-09T04:00Z', -1],
  ['fall DST 03:59Z', '2026-11-01', '2026-11-01T03:59Z', 1],
  ['fall DST 04:00Z', '2026-11-01', '2026-11-01T04:00Z', 0],
  ['fall DST 11-02 04:59Z', '2026-11-01', '2026-11-02T04:59Z', 0],
  ['fall DST 11-02 05:00Z', '2026-11-01', '2026-11-02T05:00Z', -1],
  ['multi-day', '2026-10-16', '2026-09-24T21:00Z', 22],
  ['date-only asOf across DST', '2026-11-01', '2026-10-31', 1],
  ['timestamp-suffixed earnings uses leading date', '2026-09-24T16:00:00Z', '2026-09-24T21:00Z', 0],
];

describe('daysUntilNy', () => {
  it.each(cases)('%s', (_n, e, asOf, expected) => {
    expect(daysUntilNy(e, asOf)).toBe(expected);
  });

  it.each([['2026-02-30'], ['2026-13-45'], [''], ['N/A'], [null], [undefined], [20261001]])('null for bad date %s', (bad) => {
    expect(daysUntilNy(bad as unknown, '2026-09-24T21:00Z')).toBeNull();
  });

  it('null for zoneless or unparseable asOf', () => {
    expect(daysUntilNy('2026-09-24', '2026-09-24T21:00:00')).toBeNull();
    expect(daysUntilNy('2026-09-24', 'garbage')).toBeNull();
    expect(daysUntilNy('2026-09-24', null)).toBeNull();
  });

  it('default asOf is the current NY date', () => {
    const nowIso = new Date().toISOString();
    expect(daysUntilNy(nowIso)).toBeGreaterThanOrEqual(0);
    expect(daysUntilNy(nowIso)).toBeLessThanOrEqual(1);
  });

  it('calendarDaysBetween is exact integer math', () => {
    expect(calendarDaysBetween('2026-10-31', '2026-11-02')).toBe(2);
    expect(calendarDaysBetween('2026-11-02', '2026-10-31')).toBe(-2);
  });
});
