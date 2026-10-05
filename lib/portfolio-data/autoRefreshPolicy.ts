// lib/portfolio-data/autoRefreshPolicy.ts

// PORTFOLIO-AUTOREFRESH-0001: when the open Portfolio page refreshes itself, and how fresh its numbers are.
// Pure rules -- no clock, no DOM, no React. The caller passes the instant and the page state.
//
//  * Market session: Monday-Friday 9:30-16:00 New York, minus the NYSE full-day holidays in lib/scans/nyseCalendar.ts.
//    Known limit: 13:00 early closes are treated as 16:00 closes, so on those days the page keeps refreshing for three extra
//    hours (harmless: display only). lib/discovery's exchange calendar knows early closes but may not be imported outside
//    lib/discovery (LEAPS-QV-0001 isolation guard).
//  * During the session (including the first 15 minutes, "settling"): refresh every 2 minutes while the tab is visible.
//  * Outside the session: refresh once if the data predates the most recent close, then stop ("closing values").
//  * Never while the tab is hidden, an order dialog is open (paused), or a refresh is already running.
// A refresh only updates what is displayed; it never places, changes or cancels an order.

import { isNyseBusinessDay } from '@/lib/scans/nyseCalendar';

export const AUTO_REFRESH_INTERVAL_MS = 2 * 60 * 1000;
export const SETTLING_WINDOW_MS = 15 * 60 * 1000;
export const STALE_AFTER_MS = 5 * 60 * 1000;

const DAY_MS = 86400 * 1000;
const OPEN_MINUTES = 9 * 60 + 30;
const CLOSE_MINUTES = 16 * 60;

export type MarketPhase = 'SETTLING' | 'OPEN' | 'CLOSED' | 'UNKNOWN';

export interface MarketPhaseInfo {
  phase: MarketPhase;
  /** Settling ends here (epoch ms); only set while SETTLING. */
  settlingEndsMs: number | null;
  /** Most recent completed session close (epoch ms); null when it cannot be determined. */
  lastCloseMs: number | null;
}

const NY_PARTS = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
});

/** New York wall clock for an instant: date (YYYY-MM-DD) and the same wall time expressed as if it were UTC. */
function newYorkWall(ms: number): { date: string; wallAsUtcMs: number } {
  const parts: Record<string, string> = {};
  for (const part of NY_PARTS.formatToParts(new Date(ms))) parts[part.type] = part.value;
  const hour = Number(parts.hour) % 24;
  const date = `${parts.year}-${parts.month}-${parts.day}`;
  return { date, wallAsUtcMs: Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), hour, Number(parts.minute), Number(parts.second)) };
}

/** The instant at which New York reads `minutes` past midnight on `date`. */
function newYorkInstant(date: string, minutes: number): number {
  const wall = Date.parse(`${date}T00:00:00Z`) + minutes * 60 * 1000;
  let guess = wall + 5 * 60 * 60 * 1000; // EST first guess
  for (let i = 0; i < 2; i += 1) guess += wall - newYorkWall(guess).wallAsUtcMs;
  return guess;
}

function shiftDate(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

export function portfolioMarketPhase(nowMs: number): MarketPhaseInfo {
  if (!Number.isFinite(nowMs)) return { phase: 'UNKNOWN', settlingEndsMs: null, lastCloseMs: null };
  const today = newYorkWall(nowMs).date;

  let lastCloseMs: number | null = null;
  for (let back = 0; back <= 10 && lastCloseMs == null; back += 1) {
    const day = shiftDate(today, -back);
    if (!isNyseBusinessDay(day)) continue;
    const close = newYorkInstant(day, CLOSE_MINUTES);
    if (close <= nowMs) lastCloseMs = close;
  }

  if (!isNyseBusinessDay(today)) return { phase: 'CLOSED', settlingEndsMs: null, lastCloseMs };
  const openMs = newYorkInstant(today, OPEN_MINUTES);
  const closeMs = newYorkInstant(today, CLOSE_MINUTES);
  if (nowMs < openMs || nowMs >= closeMs) return { phase: 'CLOSED', settlingEndsMs: null, lastCloseMs };
  const settlingEndsMs = openMs + SETTLING_WINDOW_MS;
  if (nowMs < settlingEndsMs) return { phase: 'SETTLING', settlingEndsMs, lastCloseMs };
  return { phase: 'OPEN', settlingEndsMs: null, lastCloseMs };
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
