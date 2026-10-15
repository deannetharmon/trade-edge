// lib/tradeLookup/resolveExpiry.ts

// TRADE-LOOKUP-0001: turns the "11/6" written in a post into a real calendar date, and says
// whether Dean can act on it.
//
// Year rule: use the pasted Discord timestamp as the reference date when there is one, otherwise
// today. The year is the first occurrence of that month/day on or after the reference date.
//
// Outcomes, checked in this order: expired, not a listed expiration (a weekend, or not in the
// chain when the caller passes the listed dates), far-date confirm (more than 180 days out), ok.
//
// Pure date math in UTC, so the result never depends on the machine's time zone.

import type { DateParts, ExpiryResolution, IsoDate, PostedExpiry } from './types';

export const FAR_DATE_DAYS = 180;

function pad2(n: number): string {
  return n < 10 ? '0' + n : String(n);
}

export function toIsoDate(p: DateParts): IsoDate {
  return p.year + '-' + pad2(p.month) + '-' + pad2(p.day);
}

function utcMs(p: DateParts): number {
  return Date.UTC(p.year, p.month - 1, p.day);
}

/** True when year/month/day is a real calendar date (rejects Feb 30, Apr 31, Feb 29 in a non-leap year). */
function isRealDate(p: DateParts): boolean {
  const d = new Date(utcMs(p));
  return d.getUTCFullYear() === p.year && d.getUTCMonth() === p.month - 1 && d.getUTCDate() === p.day;
}

function daysBetween(from: DateParts, to: DateParts): number {
  return Math.round((utcMs(to) - utcMs(from)) / 86400000);
}

function isOnOrAfter(a: DateParts, b: DateParts): boolean {
  return utcMs(a) >= utcMs(b);
}

export interface ResolveExpiryInput {
  expiry: PostedExpiry;
  /** Date from a pasted Discord timestamp. Null when none was pasted. */
  postedAt: DateParts | null;
  /** Today in the user's calendar. Passed in so the function stays pure and testable. */
  today: DateParts;
  /** ISO dates the ticker really lists, once the chain is known. Omit before the chain loads. */
  listedExpirations?: IsoDate[] | null;
}

export function resolveExpiry(input: ResolveExpiryInput): ExpiryResolution {
  const { expiry, postedAt, today, listedExpirations } = input;
  const reference = postedAt || today;

  let date: DateParts | null = null;
  if (expiry.year !== null) {
    const explicit = { year: expiry.year, month: expiry.month, day: expiry.day };
    if (isRealDate(explicit)) date = explicit;
  } else {
    // First real occurrence of month/day on or after the reference date. Four tries covers Feb 29.
    for (let y = reference.year; y <= reference.year + 4; y++) {
      const candidate = { year: y, month: expiry.month, day: expiry.day };
      if (isRealDate(candidate) && isOnOrAfter(candidate, reference)) {
        date = candidate;
        break;
      }
    }
  }
  if (date === null) {
    return { status: 'invalid_date', reason: expiry.month + '/' + expiry.day + ' is not a real calendar date.' };
  }

  const iso = toIsoDate(date);
  const daysOut = daysBetween(today, date);

  if (daysOut < 0) return { status: 'expired', date: iso, daysOut };

  const dow = new Date(utcMs(date)).getUTCDay(); // 0 Sunday ... 6 Saturday
  if (dow === 0 || dow === 6) return { status: 'not_listed', date: iso, daysOut, reason: 'weekend' };

  if (listedExpirations && listedExpirations.length > 0 && listedExpirations.indexOf(iso) === -1) {
    return { status: 'not_listed', date: iso, daysOut, reason: 'not_in_chain' };
  }

  if (daysOut > FAR_DATE_DAYS) return { status: 'confirm_far', date: iso, daysOut };
  return { status: 'ok', date: iso, daysOut };
}
