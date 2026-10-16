// lib/tradeLookup/__tests__/quoteStatus.test.ts

import { describe, expect, it } from 'vitest';
import { formatQuoteTime, marketStateLabel, quoteStatusLine, quotesMayBeStale } from '../quoteStatus';

const OPEN = new Date('2026-10-15T15:00:00Z'); // Thu 11:00 New York
const CLOSED = new Date('2026-10-16T01:00:00Z'); // Thu 21:00 New York
const SAT = new Date('2026-10-17T15:00:00Z');
const EVENING = new Date('2026-10-15T23:30:00Z'); // Thu 19:30 New York

describe('quoteStatus', () => {
  it('names the market state', () => {
    expect(marketStateLabel(OPEN)).toBe('Market open');
    expect(marketStateLabel(CLOSED)).toBe('Market closed');
    expect(marketStateLabel(SAT)).toBe('Market closed');
    expect(marketStateLabel(new Date('2026-10-15T12:00:00Z'))).toBe('Pre-market');
    expect(marketStateLabel(EVENING)).toBe('After hours');
  });
  it('flags quotes as possibly stale unless the market is open', () => {
    expect(quotesMayBeStale(OPEN)).toBe(false);
    expect(quotesMayBeStale(CLOSED)).toBe(true);
  });
  it('formats the quote time in the given zone', () => {
    expect(formatQuoteTime('2026-10-15T22:00:00Z', 'America/Denver')).toMatch(/Thu.*4:00 PM.*(MDT|GMT-6)/);
    expect(formatQuoteTime(null)).toBeNull();
    expect(formatQuoteTime('garbage')).toBeNull();
  });
  it('builds the one-line header', () => {
    expect(quoteStatusLine('2026-10-15T22:00:00Z', CLOSED, 'America/Denver')).toMatch(/^Market closed · quotes as of Thu.*4:00 PM/);
    expect(quoteStatusLine(null, OPEN)).toBe('Market open · no quote time from the broker');
  });
});
