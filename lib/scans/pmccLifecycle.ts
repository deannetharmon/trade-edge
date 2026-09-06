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

const isDate = (value: string | null): value is string => value != null && /^\d{4}-\d{2}-\d{2}$/.test(value);
const onOrBefore = (date: string | null, expiry: string) => isDate(date) && date <= expiry;

/** Monitoring only: this function never produces a roll, close, exercise, or
 * order instruction. It surfaces explicit reasons a human must review. */
export function evaluatePmccLifecycle(input: PmccLifecycleInput): { status: PmccLifecycleStatus; alerts: PmccLifecycleAlert[] } {
  const alerts: PmccLifecycleAlert[] = [];
  const today = input.now.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today) || !/^\d{4}-\d{2}-\d{2}$/.test(input.shortExpiration)) {
    return { status: 'DATA_UNAVAILABLE', alerts: [{ id: 'date', severity: 'warning', message: 'Short-call expiration is unavailable for lifecycle review.' }] };
  }
  const dte = Math.ceil((Date.parse(`${input.shortExpiration}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
  if (input.quoteAgeSeconds == null || input.quoteAgeSeconds > 15 * 60) alerts.push({ id: 'quote', severity: 'warning', message: 'Position quote is unavailable or older than 15 minutes.' });
  if (dte <= 0) alerts.push({ id: 'shortExpiry', severity: 'critical', message: 'Short call expires today or has expired; review assignment and exercise handling.' });
  else if (dte <= 7) alerts.push({ id: 'shortExpiry', severity: 'warning', message: `Short call expires in ${dte} days; schedule a manual review.` });
  const earningsDate = isDate(input.earningsDate) ? input.earningsDate : null;
  if (onOrBefore(earningsDate, input.shortExpiration) && earningsDate != null && earningsDate >= today) alerts.push({ id: 'earnings', severity: 'critical', message: `Earnings on ${earningsDate} fall within the short-call cycle.` });
  const shortNearOrItm = input.underlyingPrice != null && input.underlyingPrice >= input.shortStrike * 0.99;
  const exDividendDate = isDate(input.exDividendDate) ? input.exDividendDate : null;
  if (onOrBefore(exDividendDate, input.shortExpiration) && exDividendDate != null && exDividendDate >= today) alerts.push({ id: 'exDividend', severity: shortNearOrItm ? 'critical' : 'warning', message: shortNearOrItm ? `Ex-dividend date ${exDividendDate} with a near/ITM short call raises assignment risk.` : `Ex-dividend date ${exDividendDate} occurs before short expiration.` });
  if (shortNearOrItm) alerts.push({ id: 'shortMoneyness', severity: 'warning', message: 'Short call is near or in the money; review assignment exposure.' });
  return { status: alerts.some(a => a.severity === 'critical') ? 'ACTION_REQUIRED' : alerts.length ? 'MONITOR' : 'ON_TRACK', alerts };
}
