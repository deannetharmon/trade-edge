// lib/portfolio-data/autoRefreshPolicy.ts

// PORTFOLIO-AUTOREFRESH-0001: when the open Portfolio page refreshes itself, and how fresh its numbers are.
// Pure rules -- no clock, no DOM, no React. The caller passes the instant and the page state.
//
//  * Market session comes from the exchange calendar (holidays and 13:00 early closes included), never a fixed weekday rule.
//  * During the session (including the first 15 minutes, "settling"): refresh every 2 minutes while the tab is visible.
//  * Outside the session: refresh once if the data predates the most recent close, then stop ("closing values").
//  * Never while the tab is hidden, an order dialog is open (paused), or a refresh is already running.
// A refresh only updates what is displayed; it never places, changes or cancels an order.

import { isEarlyClose, isSessionDay, newYorkUtcOffsetSeconds, latestCompletedSession, sessionCloseEpochSeconds } from '@/lib/discovery/normalized/exchangeCalendar';
import { epochDay } from '@/lib/discovery/normalized/dates';

export const AUTO_REFRESH_INTERVAL_MS = 2 * 60 * 1000;
export const SETTLING_WINDOW_MS = 15 * 60 * 1000;
export const STALE_AFTER_MS = 5 * 60 * 1000;

const SECONDS_PER_DAY = 86400;
const OPEN_MINUTES = 9 * 60 + 30;

export type MarketPhase = 'SETTLING' | 'OPEN' | 'CLOSED' | 'UNKNOWN';

export interface MarketPhaseInfo {
  phase: MarketPhase;
  /** Settling ends here (epoch ms); only set while SETTLING. */
  settlingEndsMs: number | null;
  /** Most recent completed session close (epoch ms); null when the calendar cannot say. */
  lastCloseMs: number | null;
}

/** New York calendar day (epoch day) for an instant. */
function newYorkDay(nowSeconds: number): number {
  const utcDay = epochDay(nowSeconds);
  return epochDay(nowSeconds + newYorkUtcOffsetSeconds(utcDay));
}

export function portfolioMarketPhase(nowMs: number): MarketPhaseInfo {
  if (!Number.isFinite(nowMs)) return { phase: 'UNKNOWN', settlingEndsMs: null, lastCloseMs: null };
  const nowSeconds = Math.floor(nowMs / 1000);
  const completed = latestCompletedSession(nowSeconds);
  const lastCloseSeconds = completed == null ? null : sessionCloseEpochSeconds(completed);
  const lastCloseMs = lastCloseSeconds == null ? null : lastCloseSeconds * 1000;

  const day = newYorkDay(nowSeconds);
  const session = isSessionDay(day);
  if (session === null) return { phase: 'UNKNOWN', settlingEndsMs: null, lastCloseMs };
  if (!session) return { phase: 'CLOSED', settlingEndsMs: null, lastCloseMs };

  const openSeconds = day * SECONDS_PER_DAY + OPEN_MINUTES * 60 - newYorkUtcOffsetSeconds(day);
  const closeSeconds = sessionCloseEpochSeconds(day);
  if (closeSeconds == null || nowSeconds < openSeconds || nowSeconds >= closeSeconds) {
    return { phase: 'CLOSED', settlingEndsMs: null, lastCloseMs };
  }
  const settlingEndsMs = openSeconds * 1000 + SETTLING_WINDOW_MS;
  if (nowMs < settlingEndsMs) return { phase: 'SETTLING', settlingEndsMs, lastCloseMs };
  return { phase: 'OPEN', settlingEndsMs: null, lastCloseMs };
}

/** True on a 13:00 early-close session day (for display only). */
export function isEarlyCloseToday(nowMs: number): boolean {
  return Number.isFinite(nowMs) && isEarlyClose(newYorkDay(Math.floor(nowMs / 1000)));
}

export interface AutoRefreshState {
  nowMs: number;
  lastRefreshMs: number | null;
  visible: boolean;
  paused: boolean;
  inFlight: boolean;
}

export function isAutoRefreshDue(state: AutoRefreshState): boolean {
  if (!state.visible || state.paused || state.inFlight) return false;
  // No completed load yet: the page's own initial load owns that.
  if (state.lastRefreshMs == null || !Number.isFinite(state.lastRefreshMs)) return false;
  const { phase, lastCloseMs } = portfolioMarketPhase(state.nowMs);
  if (phase === 'OPEN' || phase === 'SETTLING') return state.nowMs - state.lastRefreshMs >= AUTO_REFRESH_INTERVAL_MS;
  if (phase === 'CLOSED') return lastCloseMs != null && state.lastRefreshMs < lastCloseMs;
  return false;
}

export type FreshnessTone = 'neutral' | 'stale';

export interface RefreshFreshness {
  text: string;
  tone: FreshnessTone;
  /** Shown while the open's wide quotes settle. */
  settlingNote: string | null;
}

function minutesAgo(nowMs: number, thenMs: number): string {
  const minutes = Math.max(0, Math.floor((nowMs - thenMs) / 60000));
  return minutes === 0 ? 'just now' : `${minutes} min ago`;
}

function newYorkClock(ms: number): string {
  return new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' }).format(new Date(ms));
}

export function refreshFreshness(nowMs: number, lastRefreshMs: number | null): RefreshFreshness | null {
  if (lastRefreshMs == null || !Number.isFinite(lastRefreshMs)) return null;
  const { phase, settlingEndsMs, lastCloseMs } = portfolioMarketPhase(nowMs);
  if (phase === 'CLOSED') {
    const closing = lastCloseMs != null && lastRefreshMs >= lastCloseMs;
    return {
      text: closing ? `Closing values · updated ${newYorkClock(lastRefreshMs)} ET` : `Updated ${minutesAgo(nowMs, lastRefreshMs)}`,
      tone: closing ? 'neutral' : 'stale',
      settlingNote: null,
    };
  }
  const stale = (phase === 'OPEN' || phase === 'SETTLING') && nowMs - lastRefreshMs > STALE_AFTER_MS;
  return {
    text: `Updated ${minutesAgo(nowMs, lastRefreshMs)}`,
    tone: stale ? 'stale' : 'neutral',
    settlingNote: phase === 'SETTLING' && settlingEndsMs != null
      ? `Market opening: quotes are wide, recommendations settle by ${newYorkClock(settlingEndsMs)} ET`
      : null,
  };
}

/**
 * Checkbox selections after an automatic refresh: kept, except positions that no longer exist (closed or filled meanwhile).
 * Returns the same Set when nothing dropped out, so React does not re-render for nothing.
 */
export function keepLiveSelections(selected: Set<string>, liveKeys: Iterable<string>): Set<string> {
  const live = new Set(liveKeys);
  const kept = new Set(Array.from(selected).filter(key => live.has(key)));
  return kept.size === selected.size ? selected : kept;
}
