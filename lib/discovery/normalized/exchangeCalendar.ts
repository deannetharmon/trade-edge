// lib/discovery/normalized/exchangeCalendar.ts

// LEAPS-QV-0001 Gate 2c (spec section 6.2) -- the US equity exchange calendar (NYSE / Nasdaq regular sessions) as pure rules, so
// "completed session" is decided by the exchange calendar and never by a guessed fixed closing time.
//
//  * Timezone: America/New_York, with US daylight-saving rules (second Sunday of March -> first Sunday of November, 2007 onward).
//  * Regular close 16:00 local; early close 13:00 local on the day after Thanksgiving, on 24 December (Monday-Thursday) and on
//    3 July when 4 July falls Tuesday-Friday.
//  * Holidays: New Year's Day (a Saturday is NOT observed on Friday), Martin Luther King Jr. Day, Presidents' Day, Good Friday,
//    Memorial Day, Juneteenth (2022 onward), Independence Day, Labor Day, Thanksgiving, Christmas (Saturday -> Friday,
//    Sunday -> Monday for the fixed-date holidays).
//  * Special closures that no rule predicts are an explicit finite list (SPECIAL_CLOSURES). A future unscheduled closure is not
//    known to this table: a bar that exists on a day the calendar calls closed makes the calendar UNAVAILABLE for that series
//    (fail closed) instead of being guessed around.
//  * Supported years 2007-2040. Outside that range the calendar returns null ("unavailable"); callers must not guess.
// No clock is read here: every function takes the instant as a parameter.

import { civilFromDays, daysFromCivil, epochDay, weekdayOfEpochDay } from './dates';

export const CALENDAR_FIRST_YEAR = 2007;
export const CALENDAR_LAST_YEAR = 2040;

const SECONDS_PER_DAY = 86400;
const REGULAR_CLOSE_MINUTES = 16 * 60;
const EARLY_CLOSE_MINUTES = 13 * 60;
const MONDAY = 1;
const THURSDAY = 4;

/** Unscheduled full-day closures (national mourning, Hurricane Sandy, September 11 2001 is before the supported range). */
const SPECIAL_CLOSURES: readonly number[] = [
  daysFromCivil(2007, 1, 2), // President Ford national day of mourning
  daysFromCivil(2012, 10, 29), // Hurricane Sandy
  daysFromCivil(2012, 10, 30), // Hurricane Sandy
  daysFromCivil(2018, 12, 5), // President G. H. W. Bush national day of mourning
  daysFromCivil(2025, 1, 9), // President Carter national day of mourning
];

function nthWeekday(year: number, month: number, weekday: number, n: number): number {
  const first = daysFromCivil(year, month, 1);
  const offset = (weekday - weekdayOfEpochDay(first) + 7) % 7;
  return first + offset + (n - 1) * 7;
}

function lastWeekday(year: number, month: number, weekday: number): number {
  const lastOfMonth = daysFromCivil(month === 12 ? year + 1 : year, month === 12 ? 1 : month + 1, 1) - 1;
  return lastOfMonth - ((weekdayOfEpochDay(lastOfMonth) - weekday + 7) % 7);
}

/** Western (Gregorian) Easter Sunday, anonymous Gregorian algorithm. */
function easterSunday(year: number): number {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return daysFromCivil(year, month, day);
}

/** Fixed-date holiday with the exchange observance rule (Saturday -> Friday, Sunday -> Monday). */
function observedFixed(year: number, month: number, day: number): number {
  const date = daysFromCivil(year, month, day);
  const weekday = weekdayOfEpochDay(date);
  if (weekday === 6) return date - 1;
  if (weekday === 0) return date + 1;
  return date;
}

const holidayCache: Record<number, Record<number, true>> = {};

function holidaysOfYear(year: number): Record<number, true> {
  const cached = holidayCache[year];
  if (cached) return cached;
  const set: Record<number, true> = {};
  const add = (day: number): void => {
    set[day] = true;
  };
  const newYear = daysFromCivil(year, 1, 1);
  if (weekdayOfEpochDay(newYear) !== 6) add(weekdayOfEpochDay(newYear) === 0 ? newYear + 1 : newYear); // Saturday: not observed
  add(nthWeekday(year, 1, MONDAY, 3)); // Martin Luther King Jr. Day
  add(nthWeekday(year, 2, MONDAY, 3)); // Presidents' Day
  add(easterSunday(year) - 2); // Good Friday
  add(lastWeekday(year, 5, MONDAY)); // Memorial Day
  if (year >= 2022) add(observedFixed(year, 6, 19)); // Juneteenth
  add(observedFixed(year, 7, 4)); // Independence Day
  add(nthWeekday(year, 9, MONDAY, 1)); // Labor Day
  add(nthWeekday(year, 11, THURSDAY, 4)); // Thanksgiving
  add(observedFixed(year, 12, 25)); // Christmas
  holidayCache[year] = set;
  return set;
}

function yearOfDay(day: number): number {
  return civilFromDays(day).year;
}

/** True when `day` (epoch day, New York date) is inside the supported range. */
export function calendarCovers(day: number): boolean {
  const year = yearOfDay(day);
  return year >= CALENDAR_FIRST_YEAR && year <= CALENDAR_LAST_YEAR;
}

/** Regular-session day per the calendar; null when the date is outside the supported range (calendar unavailable). */
export function isSessionDay(day: number): boolean | null {
  if (!calendarCovers(day)) return null;
  const weekday = weekdayOfEpochDay(day);
  if (weekday === 0 || weekday === 6) return false;
  if (SPECIAL_CLOSURES.indexOf(day) >= 0) return false;
  return holidaysOfYear(yearOfDay(day))[day] !== true;
}

/** 13:00 early close? Only meaningful on a session day. */
export function isEarlyClose(day: number): boolean {
  if (!calendarCovers(day) || isSessionDay(day) !== true) return false;
  const civil = civilFromDays(day);
  if (civil.month === 11) return day === nthWeekday(civil.year, 11, THURSDAY, 4) + 1; // day after Thanksgiving
  if (civil.month === 12 && civil.day === 24) return true; // a Friday 24 December is the observed Christmas holiday, so it is never a session
  if (civil.month === 7 && civil.day === 3) {
    const fourth = weekdayOfEpochDay(daysFromCivil(civil.year, 7, 4));
    return fourth >= 2 && fourth <= 5; // 4 July on Tuesday-Friday
  }
  return false;
}

/** UTC offset of New York in seconds on a session day (-14400 daylight, -18000 standard). Date-based: transitions are Sunday 02:00. */
export function newYorkUtcOffsetSeconds(day: number): number {
  const year = yearOfDay(day);
  const dstStart = nthWeekday(year, 3, 0, 2); // second Sunday of March
  const dstEnd = nthWeekday(year, 11, 0, 1); // first Sunday of November
  return day >= dstStart && day < dstEnd ? -4 * 3600 : -5 * 3600;
}

/** Close of the session on `day` as Unix seconds, or null when `day` is not a supported session day. */
export function sessionCloseEpochSeconds(day: number): number | null {
  if (isSessionDay(day) !== true) return null;
  const minutes = isEarlyClose(day) ? EARLY_CLOSE_MINUTES : REGULAR_CLOSE_MINUTES;
  return day * SECONDS_PER_DAY + minutes * 60 - newYorkUtcOffsetSeconds(day);
}

/** The most recent session (epoch day) whose close is at or before `nowEpochSeconds`; null when it cannot be determined. */
export function latestCompletedSession(nowEpochSeconds: number): number | null {
  if (!Number.isFinite(nowEpochSeconds)) return null;
  const today = epochDay(nowEpochSeconds);
  if (!calendarCovers(today) || !calendarCovers(today - 10)) return null;
  for (let day = today + 1; day >= today - 10; day -= 1) {
    const close = sessionCloseEpochSeconds(day);
    if (close !== null && close <= nowEpochSeconds) return day;
  }
  return null;
}

export type SessionStatus = 'OK' | 'CALENDAR_UNAVAILABLE';

export interface CompletedBars<T extends { readonly t: number }> {
  readonly bars: readonly T[];
  readonly status: SessionStatus;
  /** Trailing bars removed because their session had not completed at `now`. */
  readonly dropped: number;
}

/**
 * Removes the still-forming trailing bar(s): a bar is completed only when the exchange-calendar close of its session is at or
 * before `nowIso`. When the calendar cannot decide (date outside the supported range, or a bar on a day the calendar says the
 * exchange was closed), nothing is guessed: the bars come back unchanged with status CALENDAR_UNAVAILABLE.
 */
export function dropFormingBars<T extends { readonly t: number }>(bars: readonly T[], nowIso: string): CompletedBars<T> {
  const nowMs = Date.parse(nowIso);
  if (!Number.isFinite(nowMs)) return { bars, status: 'CALENDAR_UNAVAILABLE', dropped: 0 };
  const nowSeconds = nowMs / 1000;
  let end = bars.length;
  while (end > 0) {
    const close = sessionCloseEpochSeconds(epochDay(bars[end - 1].t));
    if (close === null) return { bars, status: 'CALENDAR_UNAVAILABLE', dropped: 0 };
    if (close <= nowSeconds) break;
    end -= 1;
  }
  return { bars: end === bars.length ? bars : bars.slice(0, end), status: 'OK', dropped: bars.length - end };
}
