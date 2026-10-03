// lib/discovery/normalized/dates.ts

// LEAPS-QV-0001 Gate 2 -- pure calendar helpers (no Date object, so nothing here can read the clock).
// Epoch seconds <-> civil date uses Howard Hinnant's days-from-civil algorithm (proleptic Gregorian, UTC).
// US session bars are stamped at the 9:30 ET open (13:30/14:30 UTC), so the UTC date equals the New York date.

export interface CivilDate {
  readonly year: number;
  readonly month: number;
  readonly day: number;
}

const SECONDS_PER_DAY = 86400;
const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

export function daysFromCivil(year: number, month: number, day: number): number {
  const y = month <= 2 ? year - 1 : year;
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const mp = (month + 9) % 12;
  const doy = Math.floor((153 * mp + 2) / 5) + day - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

export function civilFromDays(days: number): CivilDate {
  const z = days + 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const day = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const month = mp < 10 ? mp + 3 : mp - 9;
  return { year: yoe + era * 400 + (month <= 2 ? 1 : 0), month, day };
}

export function epochDay(epochSeconds: number): number {
  return Math.floor(epochSeconds / SECONDS_PER_DAY);
}

/** 0 = Sunday ... 6 = Saturday (1970-01-01 was a Thursday). */
export function weekdayOfEpochDay(day: number): number {
  return (((day + 4) % 7) + 7) % 7;
}

/** The Monday on or before the given epoch day. */
export function mondayOfEpochDay(day: number): number {
  return day - ((weekdayOfEpochDay(day) + 6) % 7);
}

export function monthIndexOfEpochDay(day: number): number {
  const civil = civilFromDays(day);
  return civil.year * 12 + (civil.month - 1);
}

function pad(value: number, width: number): string {
  return String(value).padStart(width, '0');
}

export function isoFromEpochSeconds(epochSeconds: number): string {
  const day = epochDay(epochSeconds);
  const civil = civilFromDays(day);
  const rest = epochSeconds - day * SECONDS_PER_DAY;
  const hh = Math.floor(rest / 3600);
  const mm = Math.floor((rest % 3600) / 60);
  const ss = Math.floor(rest % 60);
  return `${pad(civil.year, 4)}-${pad(civil.month, 2)}-${pad(civil.day, 2)}T${pad(hh, 2)}:${pad(mm, 2)}:${pad(ss, 2)}Z`;
}

/** Epoch day of a strict YYYY-MM-DD string, or null when it is not a real calendar date. */
export function epochDayOfDateString(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const match = DATE_ONLY.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1) return null;
  const days = daysFromCivil(year, month, day);
  const back = civilFromDays(days);
  return back.year === year && back.month === month && back.day === day ? days : null;
}

/** Epoch day of the UTC date of an ISO timestamp (Date.parse is a pure parse, not a clock read). */
export function epochDayOfIso(iso: string): number | null {
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? Math.floor(ms / 1000 / SECONDS_PER_DAY) : null;
}
