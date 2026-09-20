// lib/leaps-position-intelligence/eventNote.ts
//
// LEAPS-EVENTS-0001 -- turns the event calendar (earnings and ex-dividend dates from /api/event-risk) into the short callouts on the
// Positions income and cycle cards. Pure and rule-based, and it follows the existing event policy in lib/scans/eventRisk.ts:
// earnings on or before the short call's expiration is a blocker for a call not yet sold; an ex-dividend date before expiration is
// a blocker when the call is near or in the money (assignment risk) and a caution otherwise. Data that could not be verified is
// said plainly and never treated as "clear".

import type { DashboardCallout } from '@/lib/leaps-analysis/dashboard';
import { CYCLE_CARD_POLICY } from './cycleCard';

export type EventCheckStatus = 'loading' | 'unavailable' | 'ok';

export interface EventCalendarDates { earningsDate: string | null; exDividendDate: string | null }

export interface EventCheckInput {
  status: EventCheckStatus;
  calendar: EventCalendarDates | null;
  /** The short call's expiration (YYYY-MM-DD): the window the dates are compared with. */
  shortExpiration: string;
  /** 'candidate' is a call not yet sold; 'open-call' is one already sold. */
  mode: 'candidate' | 'open-call';
  /** The short strike is at or within the near-strike band of the stock. */
  nearItm: boolean;
  /** Today's date (YYYY-MM-DD). */
  today: string;
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const within = (date: string | null, today: string, expiration: string): date is string => date != null && ISO.test(date) && date >= today && date <= expiration;

/** True when the call is in the money or closer to the stock than the near-strike band. Unknown prices are treated as not near. */
export function isNearItm(strike: number, stockPrice: number | null | undefined): boolean {
  return stockPrice != null && stockPrice > 0 && (strike / stockPrice - 1) * 100 < CYCLE_CARD_POLICY.nearStrikePct;
}

/** The earnings date inside [today, expiry] when the calendar was verified; otherwise null (unverified data is never treated as a date). */
export function earningsDateInWindow(input: Pick<EventCheckInput, 'status' | 'calendar' | 'shortExpiration' | 'today'>): string | null {
  return input.status === 'ok' && input.calendar && within(input.calendar.earningsDate, input.today, input.shortExpiration) ? input.calendar.earningsDate : null;
}

export function buildEventCallouts(input: EventCheckInput): DashboardCallout[] {
  if (input.status === 'loading') return [{ id: 'events', tone: 'neutral', text: 'Checking earnings and ex-dividend dates…' }];
  if (input.status === 'unavailable' || !input.calendar) {
    return [{ id: 'events', tone: 'watch', text: 'Earnings and ex-dividend dates could not be verified: check them before relying on this call.' }];
  }
  const { earningsDate, exDividendDate } = input.calendar;
  const out: DashboardCallout[] = [];
  if (within(earningsDate, input.today, input.shortExpiration)) {
    out.push({ id: 'earnings', tone: input.mode === 'candidate' ? 'bad' : 'watch', text: `Earnings on ${earningsDate} fall before this call expires.` });
  }
  if (within(exDividendDate, input.today, input.shortExpiration)) {
    out.push(input.nearItm
      ? { id: 'ex-dividend', tone: 'bad', text: `The ex-dividend date ${exDividendDate} falls before expiry and the call is near or in the money: early assignment is possible.` }
      : { id: 'ex-dividend', tone: 'watch', text: `Ex-dividend date ${exDividendDate} falls before this call expires.` });
  }
  if (out.length === 0) out.push({ id: 'events', tone: 'good', text: `No earnings or ex-dividend date before ${input.shortExpiration}.` });
  return out;
}
