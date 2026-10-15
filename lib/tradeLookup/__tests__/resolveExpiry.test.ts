// lib/tradeLookup/__tests__/resolveExpiry.test.ts

// TRADE-LOOKUP-0001: date resolution cases from the ticket. "Today" is fixed at 2026-10-15
// so the results never drift with the calendar.

import { describe, expect, it } from 'vitest';
import { FAR_DATE_DAYS, resolveExpiry, toIsoDate } from '../resolveExpiry';

const TODAY = { year: 2026, month: 10, day: 15 };

describe('resolveExpiry', () => {
  it('SOXL 11/6 posted Oct 8 resolves to Fri 2026-11-06, 22 days out', () => {
    const r = resolveExpiry({ expiry: { month: 11, day: 6, year: null }, postedAt: { year: 2026, month: 10, day: 8 }, today: TODAY });
    expect(r).toEqual({ status: 'ok', date: '2026-11-06', daysOut: 22 });
  });

  it('11/13 with no timestamp resolves to 2026-11-13, 29 days out', () => {
    const r = resolveExpiry({ expiry: { month: 11, day: 13, year: null }, postedAt: null, today: TODAY });
    expect(r).toEqual({ status: 'ok', date: '2026-11-13', daysOut: 29 });
  });

  it('ETHU 8/21 posted Jun 29 2026 resolves to 2026-08-21 and is expired', () => {
    const r = resolveExpiry({ expiry: { month: 8, day: 21, year: null }, postedAt: { year: 2026, month: 6, day: 29 }, today: TODAY });
    expect(r.status).toBe('expired');
    if (r.status === 'expired') expect(r.date).toBe('2026-08-21');
  });

  it('BITX 09/18 posted Aug 19 2026 resolves to 2026-09-18 and is expired', () => {
    const r = resolveExpiry({ expiry: { month: 9, day: 18, year: null }, postedAt: { year: 2026, month: 8, day: 19 }, today: TODAY });
    expect(r.status).toBe('expired');
  });

  it('ETHU 8/21 with no timestamp rolls to 2027-08-21, a Saturday: not a listed expiration', () => {
    const r = resolveExpiry({ expiry: { month: 8, day: 21, year: null }, postedAt: null, today: TODAY });
    expect(r).toEqual({ status: 'not_listed', date: '2027-08-21', daysOut: 310, reason: 'weekend' });
  });

  it('BITX 6/18 with no timestamp is a listed Friday 246 days out: confirm', () => {
    const r = resolveExpiry({ expiry: { month: 6, day: 18, year: null }, postedAt: null, today: TODAY });
    expect(r).toEqual({ status: 'confirm_far', date: '2027-06-18', daysOut: 246 });
  });

  it('exactly 180 days out is ok, 181 needs confirming', () => {
    expect(FAR_DATE_DAYS).toBe(180);
    // 2027-04-13 is a Tuesday, 180 days after 2026-10-15; 2027-04-14 is a Wednesday, 181 days.
    expect(resolveExpiry({ expiry: { month: 4, day: 13, year: null }, postedAt: null, today: TODAY }).status).toBe('ok');
    expect(resolveExpiry({ expiry: { month: 4, day: 14, year: null }, postedAt: null, today: TODAY }).status).toBe('confirm_far');
  });

  it('expiring today is ok (0 days out)', () => {
    const r = resolveExpiry({ expiry: { month: 10, day: 15, year: null }, postedAt: null, today: TODAY });
    expect(r).toEqual({ status: 'ok', date: '2026-10-15', daysOut: 0 });
  });

  it('a date not in the real chain list is not listed, even on a weekday', () => {
    const r = resolveExpiry({
      expiry: { month: 11, day: 5, year: null },
      postedAt: null,
      today: TODAY,
      listedExpirations: ['2026-11-06', '2026-11-13'],
    });
    expect(r).toEqual({ status: 'not_listed', date: '2026-11-05', daysOut: 21, reason: 'not_in_chain' });
  });

  it('a date in the real chain list stays ok', () => {
    const r = resolveExpiry({
      expiry: { month: 11, day: 6, year: null },
      postedAt: null,
      today: TODAY,
      listedExpirations: ['2026-11-06', '2026-11-13'],
    });
    expect(r.status).toBe('ok');
  });

  it('an explicit year in the post is honored', () => {
    const r = resolveExpiry({ expiry: { month: 12, day: 18, year: 2026 }, postedAt: null, today: TODAY });
    expect(r).toEqual({ status: 'ok', date: '2026-12-18', daysOut: 64 });
  });

  it('Feb 30 is not a real date', () => {
    const r = resolveExpiry({ expiry: { month: 2, day: 30, year: null }, postedAt: null, today: TODAY });
    expect(r.status).toBe('invalid_date');
  });

  it('Feb 29 skips ahead to the next leap year', () => {
    const r = resolveExpiry({ expiry: { month: 2, day: 29, year: null }, postedAt: null, today: TODAY });
    expect(r.status).toBe('confirm_far');
    if (r.status === 'confirm_far') expect(r.date).toBe('2028-02-29');
  });

  it('toIsoDate pads single digits', () => {
    expect(toIsoDate({ year: 2026, month: 9, day: 4 })).toBe('2026-09-04');
  });
});
