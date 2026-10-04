// lib/discovery/normalized/__tests__/exchangeCalendar.test.ts

// LEAPS-QV-0001 Gate 2c (spec 6.2) -- the exchange calendar: holidays, observed holidays, early closes, DST, completed sessions.
// Dates below are published NYSE calendar facts, not values read back from the implementation.

import { describe, expect, it } from 'vitest';
import {
  CALENDAR_FIRST_YEAR,
  CALENDAR_LAST_YEAR,
  daysFromCivil,
  dropFormingBars,
  isEarlyClose,
  isSessionDay,
  latestCompletedSession,
  seriesOnSessionDays,
  newYorkUtcOffsetSeconds,
  sessionCloseEpochSeconds,
} from '..';

const day = (year: number, month: number, date: number): number => daysFromCivil(year, month, date);
const secondsOf = (iso: string): number => Date.parse(iso) / 1000;

describe('holidays', () => {
  const closed: Array<[number, number, number, string]> = [
    [2024, 1, 1, "New Year's Day"], [2024, 1, 15, 'MLK'], [2024, 2, 19, "Presidents' Day"], [2024, 3, 29, 'Good Friday'], [2024, 5, 27, 'Memorial'],
    [2024, 6, 19, 'Juneteenth'], [2024, 7, 4, 'Independence'], [2024, 9, 2, 'Labor'], [2024, 11, 28, 'Thanksgiving'], [2024, 12, 25, 'Christmas'],
    [2025, 1, 1, "New Year's Day"], [2025, 1, 20, 'MLK'], [2025, 2, 17, "Presidents' Day"], [2025, 4, 18, 'Good Friday'], [2025, 5, 26, 'Memorial'],
    [2025, 6, 19, 'Juneteenth'], [2025, 7, 4, 'Independence'], [2025, 9, 1, 'Labor'], [2025, 11, 27, 'Thanksgiving'], [2025, 12, 25, 'Christmas'],
    [2026, 1, 1, "New Year's Day"], [2026, 1, 19, 'MLK'], [2026, 2, 16, "Presidents' Day"], [2026, 4, 3, 'Good Friday'], [2026, 5, 25, 'Memorial'],
    [2026, 6, 19, 'Juneteenth'], [2026, 7, 3, 'Independence (Saturday observed Friday)'], [2026, 9, 7, 'Labor'], [2026, 11, 26, 'Thanksgiving'], [2026, 12, 25, 'Christmas'],
  ];
  closed.forEach(([y, m, d, name]) => {
    it(`${y}-${m}-${d} (${name}) is closed`, () => expect(isSessionDay(day(y, m, d))).toBe(false));
  });

  it('observed rules: Sunday -> Monday; Saturday -> Friday, except New Year\'s Day on a Saturday which is NOT observed', () => {
    expect(isSessionDay(day(2023, 1, 2))).toBe(false); // 1 January 2023 was a Sunday
    expect(isSessionDay(day(2022, 6, 20))).toBe(false); // Juneteenth 2022 was a Sunday
    expect(isSessionDay(day(2022, 12, 26))).toBe(false); // Christmas 2022 was a Sunday
    expect(isSessionDay(day(2027, 12, 24))).toBe(false); // Christmas 2027 is a Saturday -> Friday 24 December closed
    expect(isSessionDay(day(2021, 12, 31))).toBe(true); // 1 January 2022 was a Saturday: the exchange stayed open on Friday 31 December
    expect(isSessionDay(day(2020, 7, 3))).toBe(false); // 4 July 2020 was a Saturday
  });

  it('ordinary weekdays (including Columbus and Veterans days) are sessions; weekends are not', () => {
    expect(isSessionDay(day(2026, 10, 12))).toBe(true);
    expect(isSessionDay(day(2026, 11, 11))).toBe(true);
    expect(isSessionDay(day(2026, 10, 2))).toBe(true);
    expect(isSessionDay(day(2026, 10, 3))).toBe(false);
    expect(isSessionDay(day(2026, 10, 4))).toBe(false);
  });

  it('unscheduled closures are an explicit list', () => {
    expect(isSessionDay(day(2025, 1, 9))).toBe(false); // national day of mourning
    expect(isSessionDay(day(2018, 12, 5))).toBe(false);
    expect(isSessionDay(day(2012, 10, 29))).toBe(false); // Hurricane Sandy
    expect(isSessionDay(day(2007, 1, 2))).toBe(false);
  });

  it('Good Friday follows Easter (2007-04-06, 2008-03-21, 2019-04-19)', () => {
    expect(isSessionDay(day(2007, 4, 6))).toBe(false);
    expect(isSessionDay(day(2008, 3, 21))).toBe(false);
    expect(isSessionDay(day(2019, 4, 19))).toBe(false);
    expect(isSessionDay(day(2019, 4, 18))).toBe(true);
  });

  it('is unavailable (null) outside the supported years', () => {
    expect(CALENDAR_FIRST_YEAR).toBe(2007);
    expect(CALENDAR_LAST_YEAR).toBe(2040);
    expect(isSessionDay(day(2006, 12, 29))).toBeNull();
    expect(isSessionDay(day(2041, 1, 2))).toBeNull();
    expect(sessionCloseEpochSeconds(day(2041, 1, 2))).toBeNull();
    expect(latestCompletedSession(secondsOf('2041-01-03T15:00:00Z'))).toBeNull();
  });
});

describe('early closes and close times (daylight-saving aware)', () => {
  it('13:00 closes: day after Thanksgiving, 24 December, 3 July before a weekday 4 July', () => {
    [[2025, 11, 28], [2024, 11, 29], [2025, 12, 24], [2026, 12, 24], [2024, 7, 3], [2023, 7, 3], [2025, 7, 3]].forEach(([y, m, d]) => {
      expect(isEarlyClose(day(y, m, d)), `${y}-${m}-${d}`).toBe(true);
    });
  });

  it('no early close: 2 July 2026 (4 July is a Saturday), the days after a holiday weekend, 26 December, holidays themselves', () => {
    [[2026, 7, 2], [2024, 7, 5], [2025, 12, 26], [2026, 11, 25], [2026, 11, 26], [2026, 7, 3]].forEach(([y, m, d]) => {
      expect(isEarlyClose(day(y, m, d)), `${y}-${m}-${d}`).toBe(false);
    });
  });

  it('close instants: 16:00 EDT = 20:00Z, 16:00 EST = 21:00Z, 13:00 EST = 18:00Z, 13:00 EDT = 17:00Z', () => {
    expect(sessionCloseEpochSeconds(day(2026, 10, 2))).toBe(secondsOf('2026-10-02T20:00:00Z'));
    expect(sessionCloseEpochSeconds(day(2026, 1, 2))).toBe(secondsOf('2026-01-02T21:00:00Z'));
    expect(sessionCloseEpochSeconds(day(2025, 11, 28))).toBe(secondsOf('2025-11-28T18:00:00Z'));
    expect(sessionCloseEpochSeconds(day(2025, 7, 3))).toBe(secondsOf('2025-07-03T17:00:00Z'));
    expect(sessionCloseEpochSeconds(day(2026, 10, 3))).toBeNull(); // Saturday
  });

  it('daylight-saving transitions: 2026-03-08 and 2026-11-01', () => {
    expect(newYorkUtcOffsetSeconds(day(2026, 3, 6))).toBe(-5 * 3600);
    expect(newYorkUtcOffsetSeconds(day(2026, 3, 9))).toBe(-4 * 3600);
    expect(newYorkUtcOffsetSeconds(day(2026, 10, 30))).toBe(-4 * 3600);
    expect(newYorkUtcOffsetSeconds(day(2026, 11, 2))).toBe(-5 * 3600);
    expect(newYorkUtcOffsetSeconds(day(2008, 3, 10))).toBe(-4 * 3600); // second Sunday of March 2008 is the 9th
  });
});

describe('latest completed session', () => {
  const latest = (iso: string): number | null => latestCompletedSession(secondsOf(iso));
  it('is the previous session until the close, the same day from the close', () => {
    expect(latest('2026-10-02T19:59:59Z')).toBe(day(2026, 10, 1));
    expect(latest('2026-10-02T20:00:00Z')).toBe(day(2026, 10, 2));
    expect(latest('2026-10-03T14:00:00Z')).toBe(day(2026, 10, 2)); // Saturday
    expect(latest('2026-10-05T12:00:00Z')).toBe(day(2026, 10, 2)); // Monday before the open
  });
  it('skips holidays and respects early closes', () => {
    expect(latest('2026-01-19T15:00:00Z')).toBe(day(2026, 1, 16)); // MLK Monday
    expect(latest('2026-11-27T17:59:59Z')).toBe(day(2026, 11, 25)); // day after Thanksgiving, before the 13:00 close
    expect(latest('2026-11-27T18:00:00Z')).toBe(day(2026, 11, 27));
    expect(latest('2026-04-06T14:00:00Z')).toBe(day(2026, 4, 2)); // Good Friday 2026-04-03 is skipped
  });
  it('is null for a non-finite instant', () => expect(latestCompletedSession(Number.NaN)).toBeNull());
});

describe('dropFormingBars', () => {
  const bar = (y: number, m: number, d: number) => ({ t: day(y, m, d) * 86400 + 13 * 3600 + 30 * 60, c: 100 });
  const week = [bar(2026, 9, 28), bar(2026, 9, 29), bar(2026, 9, 30), bar(2026, 10, 1), bar(2026, 10, 2)];

  it('drops the still-forming bar during the session and keeps it after the close', () => {
    expect(dropFormingBars(week, '2026-10-02T15:00:00Z').bars).toHaveLength(4);
    expect(dropFormingBars(week, '2026-10-02T15:00:00Z').dropped).toBe(1);
    expect(dropFormingBars(week, '2026-10-02T20:00:00Z').bars).toHaveLength(5);
    expect(dropFormingBars(week, '2026-10-03T14:00:00Z').dropped).toBe(0);
  });

  it('uses the early-close time, not 16:00', () => {
    const bars = [bar(2025, 11, 26), bar(2025, 11, 28)];
    expect(dropFormingBars(bars, '2025-11-28T17:30:00Z').bars).toHaveLength(1); // 12:30 ET: still forming
    expect(dropFormingBars(bars, '2025-11-28T18:30:00Z').bars).toHaveLength(2); // 13:30 ET: complete (a 16:00 shortcut would drop it)
  });

  it('drops a bar dated after "now" (clock skew) rather than trusting it', () => {
    expect(dropFormingBars([bar(2026, 10, 1), bar(2026, 10, 2)], '2026-10-01T22:00:00Z').bars).toHaveLength(1);
  });

  it('validates the WHOLE series: an interior holiday / weekend / out-of-range bar fails closed even when the latest bars are valid', () => {
    const valid = [bar(2026, 9, 29), bar(2026, 9, 30), bar(2026, 10, 1), bar(2026, 10, 2)];
    const now = '2026-10-03T14:00:00Z';
    expect(dropFormingBars(valid, now).status).toBe('OK');
    const withHoliday = [bar(2026, 9, 4), bar(2026, 9, 7), ...valid]; // Labor Day inside the series
    const withWeekend = [bar(2026, 9, 25), bar(2026, 9, 26), ...valid]; // Saturday inside the series
    const withOutOfRange = [{ t: day(2006, 12, 29) * 86400 + 13 * 3600, c: 100 }, ...valid]; // first bar before 2007
    const withFarFuture = [...valid.slice(0, 2), { t: day(2041, 1, 2) * 86400 + 13 * 3600, c: 100 }]; // after the supported range
    [withHoliday, withWeekend, withOutOfRange, withFarFuture].forEach((series) => {
      const result = dropFormingBars(series, now);
      expect(result.status).toBe('CALENDAR_UNAVAILABLE');
      expect(result.dropped).toBe(0);
      expect(result.bars).toBe(series); // untouched: never removed or repaired
    });
    expect(seriesOnSessionDays(valid)).toBe(true);
    expect(seriesOnSessionDays(withHoliday)).toBe(false);
    expect(seriesOnSessionDays(withWeekend)).toBe(false);
    expect(seriesOnSessionDays(withOutOfRange)).toBe(false);
  });

  it('never guesses: an unknown calendar day or an unparseable instant returns the bars untouched, flagged unavailable', () => {
    const holiday = [bar(2026, 9, 4), bar(2026, 9, 7)]; // 7 September 2026 is Labor Day: no bar can exist
    expect(dropFormingBars(holiday, '2026-09-08T14:00:00Z')).toMatchObject({ status: 'CALENDAR_UNAVAILABLE', dropped: 0 });
    expect(dropFormingBars(week, 'not-a-time').status).toBe('CALENDAR_UNAVAILABLE');
    expect(dropFormingBars([{ t: day(2050, 1, 3) * 86400, c: 1 }], '2050-01-04T00:00:00Z').status).toBe('CALENDAR_UNAVAILABLE');
    expect(dropFormingBars([bar(2025, 1, 9)], '2025-01-10T00:00:00Z').status).toBe('CALENDAR_UNAVAILABLE');
  });
});
