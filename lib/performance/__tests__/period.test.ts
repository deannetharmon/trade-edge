import { describe, expect, it } from 'vitest';
import { PERIOD_PRESETS, presetDates, type PeriodPreset } from '../period';

// ANALYTICS-0001 A0: pins the Performance period math exactly as it behaved before the extraction.
const all = (today: string) => Object.fromEntries((['THIS_MONTH', 'LAST_MONTH', 'YTD', '3M', '6M', '12M'] as PeriodPreset[]).map(p => [p, presetDates(p, today)]));

describe('period presets', () => {
  it('lists the six presets in the Performance page order', () => {
    expect(PERIOD_PRESETS).toEqual([['THIS_MONTH', 'THIS MONTH'], ['LAST_MONTH', 'LAST MONTH'], ['YTD', 'YTD'], ['3M', '3 MO'], ['6M', '6 MO'], ['12M', '12 MO']]);
  });
  it('mid-month day', () => {
    expect(all('2026-10-06')).toEqual({
      THIS_MONTH: { from: '2026-10-01', to: '2026-10-06' },
      LAST_MONTH: { from: '2026-09-01', to: '2026-09-30' },
      YTD: { from: '2026-01-01', to: '2026-10-06' },
      '3M': { from: '2026-07-06', to: '2026-10-06' },
      '6M': { from: '2026-04-06', to: '2026-10-06' },
      '12M': { from: '2025-10-06', to: '2026-10-06' },
    });
  });
  it('January: Last month crosses the year', () => {
    expect(all('2026-01-15')).toEqual({
      THIS_MONTH: { from: '2026-01-01', to: '2026-01-15' },
      LAST_MONTH: { from: '2025-12-01', to: '2025-12-31' },
      YTD: { from: '2026-01-01', to: '2026-01-15' },
      '3M': { from: '2025-10-15', to: '2026-01-15' },
      '6M': { from: '2025-07-15', to: '2026-01-15' },
      '12M': { from: '2025-01-15', to: '2026-01-15' },
    });
  });
  it('first day of the year: This month and YTD are one day', () => {
    expect(all('2026-01-01')).toEqual({
      THIS_MONTH: { from: '2026-01-01', to: '2026-01-01' },
      LAST_MONTH: { from: '2025-12-01', to: '2025-12-31' },
      YTD: { from: '2026-01-01', to: '2026-01-01' },
      '3M': { from: '2025-10-01', to: '2026-01-01' },
      '6M': { from: '2025-07-01', to: '2026-01-01' },
      '12M': { from: '2025-01-01', to: '2026-01-01' },
    });
  });
  it('last day of the year', () => {
    expect(all('2026-12-31')).toEqual({
      THIS_MONTH: { from: '2026-12-01', to: '2026-12-31' },
      LAST_MONTH: { from: '2026-11-01', to: '2026-11-30' },
      YTD: { from: '2026-01-01', to: '2026-12-31' },
      '3M': { from: '2026-10-01', to: '2026-12-31' },
      '6M': { from: '2026-07-01', to: '2026-12-31' },
      '12M': { from: '2025-12-31', to: '2026-12-31' },
    });
  });
  it('leap day, and the day after (Last month ends on Feb 29)', () => {
    expect(all('2028-02-29')).toEqual({
      THIS_MONTH: { from: '2028-02-01', to: '2028-02-29' },
      LAST_MONTH: { from: '2028-01-01', to: '2028-01-31' },
      YTD: { from: '2028-01-01', to: '2028-02-29' },
      '3M': { from: '2027-11-29', to: '2028-02-29' },
      '6M': { from: '2027-08-29', to: '2028-02-29' },
      '12M': { from: '2027-03-01', to: '2028-02-29' },
    });
    expect(presetDates('LAST_MONTH', '2028-03-01')).toEqual({ from: '2028-02-01', to: '2028-02-29' });
  });
  it('Last month in a non-leap year ends on Feb 28', () => {
    expect(presetDates('LAST_MONTH', '2026-03-31')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
  });
  // KNOWN QUIRK, pinned as-is (extraction only; any fix is a separate Ian/Alan decision): the 3 MO, 6 MO and 12 MO
  // presets step back by calendar month on the same day number, so a month-end date that does not exist in the
  // target month rolls forward into the next month.
  it('pins the existing month-end rollback behavior', () => {
    expect(presetDates('3M', '2026-05-31')).toEqual({ from: '2026-03-03', to: '2026-05-31' }); // Feb 31 -> Mar 3
    expect(presetDates('6M', '2026-03-31')).toEqual({ from: '2025-10-01', to: '2026-03-31' }); // Sep 31 -> Oct 1
    expect(presetDates('12M', '2028-02-29')).toEqual({ from: '2027-03-01', to: '2028-02-29' }); // Feb 29 2027 -> Mar 1
  });
});
