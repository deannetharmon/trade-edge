// lib/discovery/normalized/__tests__/dates.test.ts

import { describe, expect, it } from 'vitest';
import {
  civilFromDays,
  daysFromCivil,
  epochDay,
  epochDayOfDateString,
  epochDayOfIso,
  isoFromEpochSeconds,
  mondayOfEpochDay,
  weekdayOfEpochDay,
} from '..';

describe('normalized/dates', () => {
  it('formats epoch seconds as ISO without a Date object', () => {
    expect(isoFromEpochSeconds(0)).toBe('1970-01-01T00:00:00Z');
    expect(isoFromEpochSeconds(Date.parse('2026-10-02T14:30:00Z') / 1000)).toBe('2026-10-02T14:30:00Z');
  });

  it('round-trips every day across leap years and century boundaries', () => {
    for (let day = daysFromCivil(1999, 12, 25); day <= daysFromCivil(2101, 3, 5); day += 1) {
      const civil = civilFromDays(day);
      expect(daysFromCivil(civil.year, civil.month, civil.day)).toBe(day);
    }
  });

  it('knows the weekday (2026-10-03 is a Saturday) and the Monday of a week', () => {
    const saturday = daysFromCivil(2026, 10, 3);
    expect(weekdayOfEpochDay(saturday)).toBe(6);
    expect(civilFromDays(mondayOfEpochDay(saturday))).toEqual({ year: 2026, month: 9, day: 28 });
    expect(mondayOfEpochDay(daysFromCivil(2026, 9, 28))).toBe(daysFromCivil(2026, 9, 28));
    expect(weekdayOfEpochDay(daysFromCivil(2026, 9, 27))).toBe(0);
  });

  it('accepts only real YYYY-MM-DD dates', () => {
    expect(epochDayOfDateString('2028-02-29')).toBe(daysFromCivil(2028, 2, 29));
    ['2026-02-29', '2026-13-01', '2026-00-10', '2026-1-1', '2026-10-03T00:00:00Z', '', null, 20261003].forEach((bad) => {
      expect(epochDayOfDateString(bad)).toBeNull();
    });
  });

  it('reads the UTC day of an ISO timestamp', () => {
    expect(epochDayOfIso('2026-10-03T14:00:00.000Z')).toBe(daysFromCivil(2026, 10, 3));
    expect(epochDayOfIso('nope')).toBeNull();
    expect(epochDay(86399)).toBe(0);
  });
});
