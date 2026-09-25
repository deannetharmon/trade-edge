import { newYorkDateFromAsOf, normalizeEarningsDate, parseStrictIsoDate } from './pmccEarningsDates';

export type EarningsPrecheckKind = 'none' | 'past' | 'outside-window' | 'advisory' | 'no-eligible-expiration' | 'unavailable';

export interface EarningsPrecheck {
  kind: EarningsPrecheckKind;
  earningsDate: string | null;
  daysUntil: number | null;
}

export function calendarDaysBetween(start: string, end: string): number {
  const [startYear, startMonth, startDay] = start.split('-').map(Number);
  const [endYear, endMonth, endDay] = end.split('-').map(Number);
  return Math.round((Date.UTC(endYear, endMonth - 1, endDay) - Date.UTC(startYear, startMonth - 1, startDay)) / 86_400_000);
}

/** The current market-calendar date, never the browser or server local date. */
export function currentNewYorkDate(): string {
  // A zoned ISO string is always accepted by newYorkDateFromAsOf().
  return newYorkDateFromAsOf(new Date().toISOString())!;
}

/**
 * Whole New York calendar days from the asOf NY date to dateStr (leading date
 * of a timestamp-suffixed value). Positive = future, 0 = the NY today,
 * negative = past. Null when the date or asOf is missing/invalid (a zoneless
 * asOf datetime is invalid). asOf accepts a NY date string or a zoned instant.
 */
export function daysUntilNy(dateStr: unknown, asOf: unknown = currentNewYorkDate()): number | null {
  const e = normalizeEarningsDate(dateStr);
  const t = newYorkDateFromAsOf(asOf);
  if (!e || !t) return null;
  return calendarDaysBetween(t, e);
}

/**
 * True when an earnings event is on or before this specific expiration.
 * A past event is not a future-event risk. Null means the date data was bad.
 */
export function earningsOnOrBeforeExpiration(
  earningsInput: unknown,
  expirationInput: unknown,
  asOfDate = currentNewYorkDate(),
): boolean | null {
  if (earningsInput == null || earningsInput === '') return false;
  const earningsDate = normalizeEarningsDate(earningsInput);
  const expirationDate = parseStrictIsoDate(expirationInput);
  const asOf = parseStrictIsoDate(asOfDate);
  if (!earningsDate || !expirationDate || !asOf) return null;
  if (earningsDate < asOf) return false;
  return earningsDate <= expirationDate;
}

/**
 * Symbol-level context only. It is advisory: contract eligibility is decided
 * by earningsOnOrBeforeExpiration() against each contract's expiry.
 */
export function evaluateEarningsPrecheck({
  earningsInput,
  expirations,
  dteMin,
  dteMax,
  asOfDate = currentNewYorkDate(),
}: {
  earningsInput: unknown;
  expirations: string[];
  dteMin: number;
  dteMax: number;
  asOfDate?: string;
}): EarningsPrecheck {
  if (earningsInput == null || earningsInput === '') return { kind: 'none', earningsDate: null, daysUntil: null };
  const earningsDate = normalizeEarningsDate(earningsInput);
  const asOf = parseStrictIsoDate(asOfDate);
  if (!earningsDate || !asOf) return { kind: 'unavailable', earningsDate: null, daysUntil: null };

  const daysUntil = calendarDaysBetween(asOf, earningsDate);
  if (daysUntil < 0) return { kind: 'past', earningsDate, daysUntil };
  if (daysUntil > dteMax) return { kind: 'outside-window', earningsDate, daysUntil };

  const windowExpirations = expirations.filter((expiration) => {
    const validExpiration = parseStrictIsoDate(expiration);
    if (!validExpiration) return false;
    const dte = calendarDaysBetween(asOf, validExpiration);
    return dte >= dteMin && dte <= dteMax;
  });
  const allWindowExpirationsBlocked = windowExpirations.length > 0
    && windowExpirations.every((expiration) => earningsDate <= expiration);
  return { kind: allWindowExpirationsBlocked ? 'no-eligible-expiration' : 'advisory', earningsDate, daysUntil };
}
