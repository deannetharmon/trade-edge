// lib/__tests__/pollPolicy.test.ts
import { describe, it, expect } from 'vitest';
import { shouldPollOnTimer, isClosedMarketStale, formatQuoteTime } from '@/lib/trademap/pollPolicy';

describe('pollPolicy', () => {
  it('polls on a timer only when the market is open and the tab is visible', () => {
    expect(shouldPollOnTimer({ marketOpen: true, tabVisible: true })).toBe(true);
    expect(shouldPollOnTimer({ marketOpen: false, tabVisible: true })).toBe(false);
    expect(shouldPollOnTimer({ marketOpen: true, tabVisible: false })).toBe(false);
    expect(shouldPollOnTimer({ marketOpen: false, tabVisible: false })).toBe(false);
  });
  it('labels stale quotes as market closed only when the market is closed', () => {
    expect(isClosedMarketStale('stale', false)).toBe(true);
    expect(isClosedMarketStale('warming', false)).toBe(true);
    expect(isClosedMarketStale('stale', true)).toBe(false);   // stale during market hours is a real problem
    expect(isClosedMarketStale('live', false)).toBe(false);
  });
  it('formats the quote time in New York time', () => {
    expect(formatQuoteTime(Date.UTC(2026, 10, 17, 21, 0, 0))).toBe('Nov 17, 4:00 PM ET');
    expect(formatQuoteTime(null)).toBeNull();
    expect(formatQuoteTime(NaN)).toBeNull();
  });
});
