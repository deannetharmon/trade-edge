// lib/scans/__tests__/scanUtilsDaysUntil.test.ts

import { afterEach, describe, expect, it, vi } from 'vitest';
import { daysUntil } from '../scan-utils';

afterEach(() => { vi.useRealTimers(); });

describe('daysUntil (DTE-CALENDAR-0001): calendar days in New York, not elapsed hours', () => {
  it('counts a weekly exactly 7 calendar days out as 7 at midday Denver (UBER 11/13 from 11/6)', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-06T18:00:00Z')); // 11:00 Denver, 1pm ET
    expect(daysUntil('2026-11-13')).toBe(7);
  });
  it('is stable across the day and after the close', () => {
    for (const t of ['2026-11-06T14:30:00Z', '2026-11-06T21:00:00Z', '2026-11-07T03:00:00Z']) {
      vi.useFakeTimers(); vi.setSystemTime(new Date(t));
      expect(daysUntil('2026-11-13')).toBe(7); // 03:00Z on 11/7 is still 11/6 at 10pm ET
    }
  });
  it('rolls over at New York midnight', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-07T06:00:00Z')); // 1am ET 11/7
    expect(daysUntil('2026-11-13')).toBe(6);
  });
  it('is 0 on the expiration day', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-06T17:00:00Z'));
    expect(daysUntil('2026-11-06')).toBe(0);
  });
});
