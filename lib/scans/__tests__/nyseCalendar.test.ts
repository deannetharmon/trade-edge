// lib/scans/__tests__/nyseCalendar.test.ts

// SCAN-ALIGN-0001D: NYSE calendar helpers and their pinned KNOWN LIMITS (documented in the file
// header, deliberately not fixed). Run under TZ=UTC and TZ=America/Los_Angeles with identical results.
import { describe, expect, it } from 'vitest';
import { addNyseBusinessDays, countNyseBusinessDaysAfter, isNyseBusinessDay, isNyseHoliday } from '../nyseCalendar';

describe('isNyseHoliday: the 10 standard holidays (2026)', () => {
  const holidays2026 = ['2026-01-01', '2026-01-19', '2026-02-16', '2026-04-03', '2026-05-25', '2026-06-19', '2026-07-03', '2026-09-07', '2026-11-26', '2026-12-25'];
  it.each(holidays2026)('%s is a holiday', (date) => { expect(isNyseHoliday(date)).toBe(true); });
  it('ordinary days are not holidays (day after Thanksgiving is open)', () => {
    expect(isNyseHoliday('2026-11-27')).toBe(false);
    expect(isNyseHoliday('2026-10-16')).toBe(false);
  });
});

describe('isNyseHoliday: known limits, pinned not fixed', () => {
  it('no one-off closures (2025-01-09 national day of mourning is treated as open)', () => {
    expect(isNyseHoliday('2025-01-09')).toBe(false);
    expect(isNyseBusinessDay('2025-01-09')).toBe(true);
  });
  it('Juneteenth is applied to years before NYSE observed it (2021-06-18 wrongly a holiday)', () => {
    expect(isNyseHoliday('2021-06-18')).toBe(true);
  });
  it('a Saturday Jan 1 shifts its observance into the prior year set and is never matched: Dec 31 stays a business day', () => {
    expect(isNyseHoliday('2028-01-01')).toBe(false); // Saturday, weekend anyway
    expect(isNyseHoliday('2027-12-31')).toBe(false);
    expect(isNyseBusinessDay('2027-12-31')).toBe(true);
  });
});

describe('business-day arithmetic (UTC, host-timezone independent)', () => {
  it('weekends are not business days', () => {
    expect(isNyseBusinessDay('2026-10-17')).toBe(false);
    expect(isNyseBusinessDay('2026-10-18')).toBe(false);
    expect(isNyseBusinessDay('2026-10-19')).toBe(true);
  });
  it('addNyseBusinessDays crosses weekends and holidays', () => {
    expect(addNyseBusinessDays('2026-10-16', 0)).toBe('2026-10-16');
    expect(addNyseBusinessDays('2026-10-16', 1)).toBe('2026-10-19');
    expect(addNyseBusinessDays('2026-10-16', 5)).toBe('2026-10-23');
    expect(addNyseBusinessDays('2026-10-16', 6)).toBe('2026-10-26');
    expect(addNyseBusinessDays('2026-11-20', 5)).toBe('2026-11-30'); // Thanksgiving 11-26 skipped
    expect(addNyseBusinessDays('2026-04-02', 5)).toBe('2026-04-10'); // Good Friday 04-03 skipped
  });
  it('countNyseBusinessDaysAfter counts (from, to]', () => {
    expect(countNyseBusinessDaysAfter('2026-10-16', '2026-10-16')).toBe(0);
    expect(countNyseBusinessDaysAfter('2026-10-16', '2026-10-15')).toBe(0);
    expect(countNyseBusinessDaysAfter('2026-10-16', '2026-10-17')).toBe(0);
    expect(countNyseBusinessDaysAfter('2026-10-16', '2026-10-19')).toBe(1);
    expect(countNyseBusinessDaysAfter('2026-10-16', '2026-10-23')).toBe(5);
    expect(countNyseBusinessDaysAfter('2026-04-02', '2026-04-06')).toBe(1);
  });
});
