// lib/scans/nyseCalendar.ts

// SCAN-ALIGN-0001D: NYSE holiday and business-day helpers, extracted verbatim from the private
// isNyseHoliday in pmccProduction.ts so the earnings-window logic can share them without an import
// cycle with pmccEarningsDates.ts. Pure, host-timezone independent (UTC arithmetic only), on
// YYYY-MM-DD strings.
//
// KNOWN LIMITS (documented, pinned by tests, deliberately NOT fixed here; Ian, 2026-09-24):
//   - 10 standard full-day holidays only, computed algorithmically (Good Friday via the
//     Gregorian Easter algorithm). No one-off closures (e.g. national days of mourning) and no
//     early closes (an early-close day is a business day).
//   - Juneteenth is applied to every year, including years before 2022 when NYSE did not observe it.
//   - Holidays are keyed on the queried date's own year. A Saturday Jan 1 is "observed" by shifting
//     to Dec 31 of the prior year; that entry lands in the following year's set and is never
//     matched, so Dec 31 is (correctly, by luck) treated as a business day and Jan 1 itself is a
//     weekend.
//   - Weekends-only fallback, if ever needed, must use UTC arithmetic (Date.UTC / getUTCDay), never
//     local-time helpers such as page.tsx addBusinessDays.

function observedFixedHoliday(year: number, month: number, day: number): string {
  const date = new Date(Date.UTC(year, month - 1, day));
  const weekday = date.getUTCDay();
  if (weekday === 6) date.setUTCDate(date.getUTCDate() - 1);
  if (weekday === 0) date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

function nthWeekday(year: number, month: number, weekday: number, nth: number): string {
  const date = new Date(Date.UTC(year, month - 1, 1));
  date.setUTCDate(1 + ((weekday - date.getUTCDay() + 7) % 7) + (nth - 1) * 7);
  return date.toISOString().slice(0, 10);
}

function lastWeekday(year: number, month: number, weekday: number): string {
  const date = new Date(Date.UTC(year, month, 0));
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() - weekday + 7) % 7));
  return date.toISOString().slice(0, 10);
}

function goodFriday(year: number): string {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  const date = new Date(Date.UTC(year, month - 1, day - 2));
  return date.toISOString().slice(0, 10);
}

export function isNyseHoliday(date: string): boolean {
  const year = Number(date.slice(0, 4));
  const holidays = new Set([
    observedFixedHoliday(year, 1, 1),
    nthWeekday(year, 1, 1, 3),
    nthWeekday(year, 2, 1, 3),
    goodFriday(year),
    lastWeekday(year, 5, 1),
    observedFixedHoliday(year, 6, 19),
    observedFixedHoliday(year, 7, 4),
    nthWeekday(year, 9, 1, 1),
    nthWeekday(year, 11, 4, 4),
    observedFixedHoliday(year, 12, 25),
  ]);
  return holidays.has(date);
}

function utcDateOf(date: string): Date {
  const d = new Date(0);
  d.setUTCFullYear(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)));
  return d;
}

function isoOf(d: Date): string {
  const y = String(d.getUTCFullYear()).padStart(4, '0');
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Monday-Friday and not an NYSE holiday. `date` must be a valid YYYY-MM-DD. */
export function isNyseBusinessDay(date: string): boolean {
  const weekday = utcDateOf(date).getUTCDay();
  return weekday !== 0 && weekday !== 6 && !isNyseHoliday(date);
}

/** The date `n` NYSE business days after `date` (n >= 0; n = 0 returns `date` unchanged, even if it is not a business day). */
export function addNyseBusinessDays(date: string, n: number): string {
  const d = utcDateOf(date);
  let remaining = n;
  while (remaining > 0) {
    d.setUTCDate(d.getUTCDate() + 1);
    if (isNyseBusinessDay(isoOf(d))) remaining -= 1;
  }
  return isoOf(d);
}

/** Number of NYSE business days in (from, to]. 0 when `to` is not after `from`. */
export function countNyseBusinessDaysAfter(from: string, to: string): number {
  if (to <= from) return 0;
  const d = utcDateOf(from);
  let count = 0;
  let guard = 0;
  while (isoOf(d) < to && guard < 4000) {
    d.setUTCDate(d.getUTCDate() + 1);
    guard += 1;
    if (isNyseBusinessDay(isoOf(d))) count += 1;
  }
  return count;
}
