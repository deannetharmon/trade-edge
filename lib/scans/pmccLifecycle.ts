// lib/scans/pmccLifecycle.ts

import { calendarDaysBetween } from './earningsPrecheck';
import { newYorkDateFromAsOf, normalizeEarningsDate, parseStrictIsoDate } from './pmccEarningsDates';

export type PmccLifecycleStatus = 'ON_TRACK' | 'MONITOR' | 'ACTION_REQUIRED' | 'DATA_UNAVAILABLE';
export type PmccLifecycleAlert = { id: string; severity: 'info' | 'warning' | 'critical'; message: string };

export interface PmccLifecycleInput {
  now: string;
  shortExpiration: string;
  shortStrike: number;
  underlyingPrice: number | null;
  quoteAgeSeconds: number | null;
  earningsDate: string | null;
  exDividendDate: string | null;
}

// EARNINGS-DATEBASIS-0001: strict calendar validation (no regex-only isDate), and every
// day comparison (short expiry, earnings, ex-dividend) shares one New York "today".
const onOrBefore = (date: string | null, expiry: string) => date != null && date <= expiry;

/** Monitoring only: this function never produces a roll, close, exercise, or
 * order instruction. It surfaces explicit reasons a human must review. */
export function evaluatePmccLifecycle(input: PmccLifecycleInput): { status: PmccLifecycleStatus; alerts: PmccLifecycleAlert[] } {
  const alerts: PmccLifecycleAlert[] = [];
  // A date-only `now` is taken as the NY date; a datetime needs a zone (zoneless returns null).
  const today = newYorkDateFromAsOf(input.now);
  const shortExpiration = parseStrictIsoDate(input.shortExpiration);
  if (!today || !shortExpiration) {
    return { status: 'DATA_UNAVAILABLE', alerts: [{ id: 'date', severity: 'warning', message: 'Short-call expiration is unavailable for lifecycle review.' }] };
  }
  const dte = calendarDaysBetween(today, shortExpiration);
  if (input.quoteAgeSeconds == null || input.quoteAgeSeconds > 15 * 60) alerts.push({ id: 'quote', severity: 'warning', message: 'Position quote is unavailable or older than 15 minutes.' });
  if (dte <= 0) alerts.push({ id: 'shortExpiry', severity: 'critical', message: 'Short call expires today or has expired; review assignment and exercise handling.' });
  else if (dte <= 7) alerts.push({ id: 'shortExpiry', severity: 'warning', message: `Short call expires in ${dte} ${dte === 1 ? 'day' : 'days'}; schedule a manual review.` });
  const earningsDate = normalizeEarningsDate(input.earningsDate);
  if (earningsDate != null && onOrBefore(earningsDate, shortExpiration) && earningsDate >= today) alerts.push({ id: 'earnings', severity: 'critical', message: `Earnings on ${earningsDate} fall within the short-call cycle.` });
  const shortNearOrItm = input.underlyingPrice != null && input.underlyingPrice >= input.shortStrike * 0.99;
  const exDividendDate = normalizeEarningsDate(input.exDividendDate);
  if (onOrBefore(exDividendDate, shortExpiration) && exDividendDate != null && exDividendDate >= today) alerts.push({ id: 'exDividend', severity: shortNearOrItm ? 'critical' : 'warning', message: shortNearOrItm ? `Ex-dividend date ${exDividendDate} with a near/ITM short call raises assignment risk.` : `Ex-dividend date ${exDividendDate} occurs before short expiration.` });
  if (shortNearOrItm) alerts.push({ id: 'shortMoneyness', severity: 'warning', message: 'Short call is near or in the money; review assignment exposure.' });
  return { status: alerts.some(a => a.severity === 'critical') ? 'ACTION_REQUIRED' : alerts.length ? 'MONITOR' : 'ON_TRACK', alerts };
}
