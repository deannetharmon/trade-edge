// lib/portfolio-intelligence/__tests__/earningsDateBasis.test.ts
// EARNINGS-DATEBASIS-0001: position-objective earnings day math on the New York basis.

import { describe, expect, it } from 'vitest';
import { daysUntil, isUpcomingBeforeExpiration } from '../objectives/positionObjective';

const NOWS = ['2026-09-24T13:00:00Z', '2026-09-24T21:00:00Z', '2026-09-25T03:30:00Z'];

describe('position objective earnings date basis', () => {
  it.each(NOWS)('earnings day is 0 days at %s and past at NY midnight', (iso) => {
    expect(daysUntil('2026-09-24', new Date(iso))).toBe(0);
    expect(daysUntil('2026-09-24', new Date('2026-09-25T04:00:00Z'))).toBe(-1);
    expect(daysUntil('2026-09-24', new Date('2026-09-24T03:59:00Z'))).toBe(1);
  });
  it('bad dates and invalid clocks return null', () => {
    expect(daysUntil('2026-02-30', new Date(NOWS[0]))).toBeNull();
    expect(daysUntil('N/A', new Date(NOWS[0]))).toBeNull();
    expect(daysUntil(null, new Date(NOWS[0]))).toBeNull();
    expect(daysUntil('2026-09-24', new Date('nope'))).toBeNull();
  });
  it.each(NOWS)('upcoming-before-expiration is inclusive on both edges at %s', (iso) => {
    const now = new Date(iso);
    expect(isUpcomingBeforeExpiration('2026-09-24', '2026-10-16', now)).toBe(true);
    expect(isUpcomingBeforeExpiration('2026-10-16', '2026-10-16', now)).toBe(true);
    expect(isUpcomingBeforeExpiration('2026-10-17', '2026-10-16', now)).toBe(false);
    expect(isUpcomingBeforeExpiration('2026-09-23', '2026-10-16', now)).toBe(false);
    expect(isUpcomingBeforeExpiration('2026-09-24', null, now)).toBe(true);
  });
});
