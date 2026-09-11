import { PMCC_FINDER_POLICY_VERSIONS } from './pmccFinderPolicy';

export type EarningsEvidence =
  | { status: 'confirmed'; scheduledDate: string; scheduledTime: 'before-market' | 'after-market' | 'unknown'; source: string; asOf: string }
  | { status: 'pending-estimated'; rangeStart: string; rangeEnd: string; source: string; asOf: string }
  | { status: 'not-scheduled'; coverageThrough: string; source: string; asOf: string }
  | { status: 'not-applicable'; source: string; asOf: string }
  | { status: 'unknown' | 'stale'; reason: string; source: string | null; asOf: string | null };

export type EarningsProximityStatus = 'pass' | 'caution' | 'fail' | 'unavailable' | 'not-applicable';

export interface EarningsProximityEvaluation {
  policyVersion: typeof PMCC_FINDER_POLICY_VERSIONS.earnings;
  status: EarningsProximityStatus;
  evidenceStatus: EarningsEvidence['status'];
  tradingSessionsBetween: number | null;
  eventDateUsed: string | null;
  explanation: string;
}

function parseDateOnly(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return date.getUTCFullYear() === Number(match[1]) && date.getUTCMonth() === Number(match[2]) - 1 && date.getUTCDate() === Number(match[3]) ? date : null;
}

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export type TradingSessionPredicate = (date: Date) => boolean;

export const weekdayTradingSession: TradingSessionPredicate = date => {
  const day = date.getUTCDay();
  return day !== 0 && day !== 6;
};

export function tradingSessionsStrictlyBetween(start: string, end: string, isTradingSession: TradingSessionPredicate = weekdayTradingSession): number | null {
  const startDate = parseDateOnly(start);
  const endDate = parseDateOnly(end);
  if (!startDate || !endDate) return null;
  if (endDate <= startDate) return 0;
  let count = 0;
  const cursor = new Date(startDate);
  cursor.setUTCDate(cursor.getUTCDate() + 1);
  while (cursor < endDate) {
    if (isTradingSession(cursor)) count += 1;
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return count;
}

export function addTradingSessions(start: string, sessions: number, isTradingSession: TradingSessionPredicate = weekdayTradingSession): string | null {
  const startDate = parseDateOnly(start);
  if (!startDate || !Number.isInteger(sessions) || sessions < 0) return null;
  const cursor = new Date(startDate);
  let remaining = sessions;
  while (remaining > 0) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    if (isTradingSession(cursor)) remaining -= 1;
  }
  return isoDay(cursor);
}

export function evaluateEarningsProximity(
  shortExpiration: string,
  evidence: EarningsEvidence,
  isTradingSession: TradingSessionPredicate = weekdayTradingSession,
): EarningsProximityEvaluation {
  const base = { policyVersion: PMCC_FINDER_POLICY_VERSIONS.earnings, evidenceStatus: evidence.status } as const;
  if (!parseDateOnly(shortExpiration)) return { ...base, status: 'unavailable', tradingSessionsBetween: null, eventDateUsed: null, explanation: 'Short expiration is invalid.' };
  if (evidence.status === 'not-applicable') return { ...base, status: 'not-applicable', tradingSessionsBetween: null, eventDateUsed: null, explanation: 'Earnings are not applicable to this underlying classification.' };
  if ('reason' in evidence) return { ...base, status: 'unavailable', tradingSessionsBetween: null, eventDateUsed: null, explanation: evidence.reason };

  if (evidence.status === 'not-scheduled') {
    const requiredCoverage = addTradingSessions(shortExpiration, 10, isTradingSession);
    const coverageValid = parseDateOnly(evidence.coverageThrough) != null && requiredCoverage != null && evidence.coverageThrough >= requiredCoverage;
    return coverageValid
      ? { ...base, status: 'pass', tradingSessionsBetween: null, eventDateUsed: null, explanation: `No event is scheduled through ${evidence.coverageThrough}, covering the preferred buffer.` }
      : { ...base, status: 'unavailable', tradingSessionsBetween: null, eventDateUsed: null, explanation: 'No-event evidence does not cover expiration plus the required buffer.' };
  }

  if (evidence.status === 'pending-estimated') {
    const rangeStart = parseDateOnly(evidence.rangeStart);
    const rangeEnd = parseDateOnly(evidence.rangeEnd);
    if (!rangeStart || !rangeEnd || rangeEnd < rangeStart) {
      return { ...base, status: 'unavailable', tradingSessionsBetween: null, eventDateUsed: evidence.rangeStart, explanation: 'Estimated earnings evidence requires a valid bounded date range.' };
    }
  }

  const eventDate = evidence.status === 'confirmed' ? evidence.scheduledDate : evidence.rangeStart;
  const sessions = tradingSessionsStrictlyBetween(shortExpiration, eventDate, isTradingSession);
  if (sessions == null || !parseDateOnly(eventDate)) return { ...base, status: 'unavailable', tradingSessionsBetween: null, eventDateUsed: eventDate, explanation: 'Earnings evidence contains an invalid date.' };
  if (evidence.status === 'pending-estimated' && (eventDate <= shortExpiration || sessions < 10)) {
    return { ...base, status: 'unavailable', tradingSessionsBetween: sessions, eventDateUsed: eventDate, explanation: 'Estimated earnings may overlap the short-call life or required ten-session buffer.' };
  }
  if (eventDate <= shortExpiration) return { ...base, status: 'fail', tradingSessionsBetween: 0, eventDateUsed: eventDate, explanation: 'Short call expires on or after the earnings event.' };
  if (sessions < 5) return { ...base, status: 'fail', tradingSessionsBetween: sessions, eventDateUsed: eventDate, explanation: 'Fewer than five trading sessions separate expiration and earnings.' };
  if (sessions < 10) return { ...base, status: 'caution', tradingSessionsBetween: sessions, eventDateUsed: eventDate, explanation: 'Five through nine trading sessions separate expiration and earnings.' };
  return { ...base, status: 'pass', tradingSessionsBetween: sessions, eventDateUsed: eventDate, explanation: 'At least ten trading sessions separate expiration and earnings.' };
}
