// lib/scans/pmccEarningsDates.ts

// PMCC-EARNINGS-PAST-0001 -- strict, pure, host-timezone-independent ISO date
// handling for the PMCC earnings gate. Deliberately NOT a reuse of the
// regex-only `isDate` in pmccLifecycle.ts (it accepts "2026-02-30").
//
// Grammars (Alan, 2026-09-24):
//   earnings: YYYY-MM-DD | YYYY-MM-DDThh:mm[:ss[.f+]][Z|+-hh:mm]
//   asOf:     same, except a datetime REQUIRES a zone (Z or +-hh:mm)
// No trimming, no lowercase t/z, no space separator, no 24:00.

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|[+-]\d{2}:\d{2})?)?$/;
const DATE_ONLY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/** True only for a real calendar date (year 0001-9999, month 1-12, day within the month). */
function isRealCalendarDate(year: number, month: number, day: number): boolean {
  if (year < 1 || month < 1 || month > 12 || day < 1) return false;
  const dim = [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  return day <= dim;
}

/** Strict date-only validator: exactly YYYY-MM-DD and a real calendar date. Returns the input, or null. */
export function parseStrictIsoDate(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const m = DATE_ONLY_RE.exec(value);
  if (!m) return null;
  return isRealCalendarDate(Number(m[1]), Number(m[2]), Number(m[3])) ? value : null;
}

interface ParsedIso {
  date: string;
  hasTime: boolean;
  year: number; month: number; day: number;
  hour: number; minute: number; second: number;
  /** Offset in minutes east of UTC; null when the datetime has no zone. */
  offsetMinutes: number | null;
}

function parseIso(value: unknown): ParsedIso | null {
  if (typeof value !== 'string') return null;
  const m = ISO_RE.exec(value);
  if (!m) return null;
  const year = Number(m[1]); const month = Number(m[2]); const day = Number(m[3]);
  if (!isRealCalendarDate(year, month, day)) return null;
  const date = `${m[1]}-${m[2]}-${m[3]}`;
  if (m[4] === undefined) {
    return { date, hasTime: false, year, month, day, hour: 0, minute: 0, second: 0, offsetMinutes: null };
  }
  const hour = Number(m[4]); const minute = Number(m[5]); const second = m[6] === undefined ? 0 : Number(m[6]);
  if (hour > 23 || minute > 59 || second > 59) return null;
  let offsetMinutes: number | null = null;
  if (m[7] !== undefined) {
    if (m[7] === 'Z') offsetMinutes = 0;
    else {
      const oh = Number(m[7].slice(1, 3)); const om = Number(m[7].slice(4, 6));
      if (oh > 23 || om > 59) return null;
      offsetMinutes = (m[7][0] === '-' ? -1 : 1) * (oh * 60 + om);
    }
  }
  return { date, hasTime: true, year, month, day, hour, minute, second, offsetMinutes };
}

/**
 * Normalize an earnings value to its leading calendar date (YYYY-MM-DD), with
 * no timezone conversion. Returns null for anything malformed (treated as "no
 * date on file" by the gate).
 */
export function normalizeEarningsDate(value: unknown): string | null {
  return parseIso(value)?.date ?? null;
}

const NY_DATE_PARTS = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
});

function newYorkDateOfInstant(ms: number): string | null {
  const d = new Date(ms);
  if (!Number.isFinite(d.getTime())) return null;
  const parts = NY_DATE_PARTS.formatToParts(d);
  const pick = (type: string) => parts.find(p => p.type === type)?.value;
  const y = pick('year'); const mo = pick('month'); const da = pick('day');
  if (!y || !mo || !da) return null;
  return `${y.padStart(4, '0')}-${mo}-${da}`;
}

/**
 * The New York (market) calendar date for an `asOf` string, or null when
 * missing/unparseable. A date-only value is already a calendar date and is
 * returned as is (no conversion). A datetime must carry a zone; the instant
 * is computed arithmetically (never via host-local getters).
 */
export function newYorkDateFromAsOf(asOf: unknown): string | null {
  const parsed = parseIso(asOf);
  if (!parsed) return null;
  if (!parsed.hasTime) return parsed.date;
  if (parsed.offsetMinutes === null) return null;
  const probe = new Date(0);
  probe.setUTCFullYear(parsed.year, parsed.month - 1, parsed.day);
  probe.setUTCHours(parsed.hour, parsed.minute, parsed.second, 0);
  return newYorkDateOfInstant(probe.getTime() - parsed.offsetMinutes * 60_000);
}
