// lib/wheel/__tests__/marketHours.test.ts
//
// WHEEL-SYSTEM-0002 (W2) -- regular US market hours in New York time (daylight saving handled by the time zone).

import { describe, expect, it } from 'vitest';
import { isMarketOpen } from '../marketHours';

// 2026-09-28 is a Monday; New York is on daylight time (UTC-4) in September and standard time (UTC-5) in January.
describe('isMarketOpen', () => {
  it('open at 9:30 and just before 16:00 on a weekday; closed at 9:29 and at 16:00', () => {
    expect(isMarketOpen(new Date('2026-09-28T13:30:00Z'))).toBe(true); // 9:30 ET
    expect(isMarketOpen(new Date('2026-09-28T13:29:00Z'))).toBe(false); // 9:29 ET
    expect(isMarketOpen(new Date('2026-09-28T19:59:00Z'))).toBe(true); // 15:59 ET
    expect(isMarketOpen(new Date('2026-09-28T20:00:00Z'))).toBe(false); // 16:00 ET
  });
  it('closed all weekend, including Dean\'s Saturday 9 PM screenshot', () => {
    expect(isMarketOpen(new Date('2026-09-27T01:00:00Z'))).toBe(false); // Saturday 21:00 ET
    expect(isMarketOpen(new Date('2026-09-26T15:00:00Z'))).toBe(false); // Saturday 11:00 ET
    expect(isMarketOpen(new Date('2026-09-27T15:00:00Z'))).toBe(false); // Sunday
  });
  it('uses New York time in winter as well (UTC-5)', () => {
    expect(isMarketOpen(new Date('2027-01-05T14:30:00Z'))).toBe(true); // Tuesday 9:30 ET
    expect(isMarketOpen(new Date('2027-01-05T14:29:00Z'))).toBe(false);
  });
  it('closed overnight on a weekday', () => {
    expect(isMarketOpen(new Date('2026-09-29T04:00:00Z'))).toBe(false); // Tuesday 00:00 ET
  });
});
