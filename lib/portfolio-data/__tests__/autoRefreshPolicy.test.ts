// lib/portfolio-data/__tests__/autoRefreshPolicy.test.ts

import { describe, expect, it } from 'vitest';
import {
  AUTO_REFRESH_INTERVAL_MS,
  isAutoRefreshDue,
  isEarlyCloseToday,
  keepLiveSelections,
  portfolioMarketPhase,
  refreshFreshness,
} from '../autoRefreshPolicy';

const at = (iso: string) => Date.parse(iso);
const MIN = 60 * 1000;

// 2026-10-05 is a Monday (EDT, UTC-4): open 13:30Z, close 20:00Z.
const MON_OPEN = at('2026-10-05T13:30:00Z');
const MON_CLOSE = at('2026-10-05T20:00:00Z');

describe('portfolioMarketPhase', () => {
  it('is SETTLING for the first 15 minutes after the open, then OPEN', () => {
    expect(portfolioMarketPhase(MON_OPEN).phase).toBe('SETTLING');
    expect(portfolioMarketPhase(MON_OPEN + 14 * MIN).phase).toBe('SETTLING');
    expect(portfolioMarketPhase(MON_OPEN + 14 * MIN).settlingEndsMs).toBe(MON_OPEN + 15 * MIN);
    expect(portfolioMarketPhase(MON_OPEN + 15 * MIN).phase).toBe('OPEN');
  });

  it('is CLOSED before the open, at and after the close, and reports the last close', () => {
    expect(portfolioMarketPhase(MON_OPEN - 1).phase).toBe('CLOSED');
    expect(portfolioMarketPhase(MON_CLOSE).phase).toBe('CLOSED');
    expect(portfolioMarketPhase(MON_CLOSE + 60 * MIN).lastCloseMs).toBe(MON_CLOSE);
  });

  it('is CLOSED on weekends and exchange holidays', () => {
    expect(portfolioMarketPhase(at('2026-10-04T15:00:00Z')).phase).toBe('CLOSED'); // Sunday
    expect(portfolioMarketPhase(at('2026-11-26T16:00:00Z')).phase).toBe('CLOSED'); // Thanksgiving
  });

  it('honours the 13:00 early close (day after Thanksgiving, EST)', () => {
    const friday = at('2026-11-27T17:59:00Z'); // 12:59 New York
    expect(isEarlyCloseToday(friday)).toBe(true);
    expect(portfolioMarketPhase(friday).phase).toBe('OPEN');
    expect(portfolioMarketPhase(at('2026-11-27T18:00:00Z')).phase).toBe('CLOSED');
  });

  it('uses the New York date in the evening (UTC already the next day)', () => {
    // Monday 21:30 New York = Tuesday 01:30Z: closed, last close is Monday.
    expect(portfolioMarketPhase(at('2026-10-06T01:30:00Z'))).toMatchObject({ phase: 'CLOSED', lastCloseMs: MON_CLOSE });
  });

  it('is UNKNOWN for an invalid instant', () => {
    expect(portfolioMarketPhase(Number.NaN).phase).toBe('UNKNOWN');
  });
});

describe('isAutoRefreshDue', () => {
  const base = { visible: true, paused: false, inFlight: false };
  const midday = MON_OPEN + 120 * MIN;

  it('refreshes every 2 minutes during the session, including settling', () => {
    expect(isAutoRefreshDue({ ...base, nowMs: midday, lastRefreshMs: midday - AUTO_REFRESH_INTERVAL_MS })).toBe(true);
    expect(isAutoRefreshDue({ ...base, nowMs: midday, lastRefreshMs: midday - AUTO_REFRESH_INTERVAL_MS + 1 })).toBe(false);
    expect(isAutoRefreshDue({ ...base, nowMs: MON_OPEN + 5 * MIN, lastRefreshMs: MON_OPEN + 2 * MIN })).toBe(true);
  });

  it('never refreshes while hidden, paused by an order dialog, or already running', () => {
    const due = { nowMs: midday, lastRefreshMs: midday - 10 * MIN };
    expect(isAutoRefreshDue({ ...base, ...due, visible: false })).toBe(false);
    expect(isAutoRefreshDue({ ...base, ...due, paused: true })).toBe(false);
    expect(isAutoRefreshDue({ ...base, ...due, inFlight: true })).toBe(false);
  });

  it('leaves the first load to the page', () => {
    expect(isAutoRefreshDue({ ...base, nowMs: midday, lastRefreshMs: null })).toBe(false);
  });

  it('after the close refreshes once, then stops', () => {
    const evening = MON_CLOSE + 90 * MIN;
    expect(isAutoRefreshDue({ ...base, nowMs: evening, lastRefreshMs: MON_CLOSE - 1 * MIN })).toBe(true);
    expect(isAutoRefreshDue({ ...base, nowMs: evening, lastRefreshMs: MON_CLOSE + 1 * MIN })).toBe(false);
  });

  it('on a weekend refreshes only data older than Friday\'s close', () => {
    const sunday = at('2026-10-04T15:00:00Z');
    const fridayClose = at('2026-10-02T20:00:00Z');
    expect(isAutoRefreshDue({ ...base, nowMs: sunday, lastRefreshMs: fridayClose - MIN })).toBe(true);
    expect(isAutoRefreshDue({ ...base, nowMs: sunday, lastRefreshMs: fridayClose + MIN })).toBe(false);
  });
});

describe('refreshFreshness', () => {
  const midday = MON_OPEN + 120 * MIN;

  it('shows minutes ago, amber only after 5 minutes during the session', () => {
    expect(refreshFreshness(midday, midday - 30 * 1000)).toEqual({ text: 'Updated just now', tone: 'neutral', settlingNote: null });
    expect(refreshFreshness(midday, midday - 5 * MIN)).toMatchObject({ text: 'Updated 5 min ago', tone: 'neutral' });
    expect(refreshFreshness(midday, midday - 6 * MIN)).toMatchObject({ text: 'Updated 6 min ago', tone: 'stale' });
  });

  it('adds the settling note in the first 15 minutes', () => {
    expect(refreshFreshness(MON_OPEN + 3 * MIN, MON_OPEN + 2 * MIN)?.settlingNote)
      .toBe('Market opening: quotes are wide, recommendations settle by 9:45 AM ET');
  });

  it('labels post-close data as closing values, and pre-close data after the close as stale', () => {
    const evening = MON_CLOSE + 90 * MIN;
    expect(refreshFreshness(evening, MON_CLOSE + 5 * MIN)).toEqual({ text: 'Closing values · updated 4:05 PM ET', tone: 'neutral', settlingNote: null });
    expect(refreshFreshness(evening, MON_CLOSE - 60 * MIN)).toMatchObject({ tone: 'stale' });
  });

  it('is null before the first load', () => {
    expect(refreshFreshness(midday, null)).toBeNull();
  });
});

describe('keepLiveSelections', () => {
  it('keeps every selection whose position still exists, returning the same Set when nothing changed', () => {
    const selected = new Set(['A', 'B']);
    expect(keepLiveSelections(selected, ['A', 'B', 'C'])).toBe(selected);
  });

  it('drops only selections whose position closed or filled meanwhile', () => {
    expect(Array.from(keepLiveSelections(new Set(['A', 'B']), ['B', 'C']))).toEqual(['B']);
  });
});
