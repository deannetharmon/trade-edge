// features/portfolio/positions-workspace/__tests__/nextEarnings.test.ts

import { describe, expect, it } from 'vitest';
import { nextEarningsLine } from '../model/nextEarnings';

const TODAY = '2026-09-25';

describe('nextEarningsLine', () => {
  it('shows the date and how far away it is', () => {
    expect(nextEarningsLine('2026-11-05', false, '2026-12-18', TODAY)).toEqual({ text: 'Earnings Nov 5 · in 41d', daysAway: 41, beforeExpiry: true });
  });
  it('marks a projected date as estimated, and says nothing extra when the provider does not say', () => {
    expect(nextEarningsLine('2026-11-05', true, '2026-10-30', TODAY)?.text).toBe('Earnings Nov 5 (est.) · in 41d');
    expect(nextEarningsLine('2026-11-05', null, '2026-10-30', TODAY)?.text).toBe('Earnings Nov 5 · in 41d');
  });
  it('flags whether it falls on or before the position expires (the boundary day counts as before)', () => {
    expect(nextEarningsLine('2026-11-05', false, '2026-10-30', TODAY)?.beforeExpiry).toBe(false);
    expect(nextEarningsLine('2026-11-05', false, '2026-11-05', TODAY)?.beforeExpiry).toBe(true);
    expect(nextEarningsLine('2026-11-05', false, '2026-11-20', TODAY)?.beforeExpiry).toBe(true);
    expect(nextEarningsLine('2026-11-05', false, null, TODAY)?.beforeExpiry).toBe(false);
  });
  it('says today and tomorrow in words', () => {
    expect(nextEarningsLine('2026-09-25', false, '2026-10-30', TODAY)?.text).toBe('Earnings Sep 25 · today');
    expect(nextEarningsLine('2026-09-26', false, '2026-10-30', TODAY)?.text).toBe('Earnings Sep 26 · tomorrow');
  });
  it('shows nothing when the date is unknown, past, or unusable', () => {
    for (const bad of [null, undefined, '', 'soon', '2026-09-24', '2026-13-40']) expect(nextEarningsLine(bad as never, false, '2026-10-30', TODAY)).toBeNull();
  });
});
