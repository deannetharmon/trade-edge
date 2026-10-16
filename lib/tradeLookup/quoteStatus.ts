// lib/tradeLookup/quoteStatus.ts

// TRADE-LOOKUP-0001D: the one-line "Market closed · quotes as of 4:00 PM" header. Market state comes from the same
// helper the order dialogs use (derivePmccMarketSession), so the lookup and the order window never disagree.

import { derivePmccMarketSession } from '@/lib/scans/pmccProduction';

const SESSION_LABEL: Record<string, string> = {
  open: 'Market open',
  pre_market: 'Pre-market',
  after_hours: 'After hours',
  closed: 'Market closed',
  unknown: 'Market state unknown',
};

export function marketStateLabel(now: Date): string {
  return SESSION_LABEL[derivePmccMarketSession(now)] || SESSION_LABEL.unknown;
}

export function formatQuoteTime(iso: string | null, timeZone?: string): string | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  if (!isFinite(ms)) return null;
  const opts: Intl.DateTimeFormatOptions = { weekday: 'short', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' };
  if (timeZone) opts.timeZone = timeZone;
  return new Intl.DateTimeFormat('en-US', opts).format(new Date(ms));
}

/** "Market closed · quotes as of Thu, 4:00 PM MDT". Quotes outside regular hours can be stale or wide, so the line says so. */
export function quoteStatusLine(quotesAsOf: string | null, now: Date, timeZone?: string): string {
  const state = marketStateLabel(now);
  const at = formatQuoteTime(quotesAsOf, timeZone);
  return state + ' · ' + (at ? 'quotes as of ' + at : 'no quote time from the broker');
}

export function quotesMayBeStale(now: Date): boolean {
  return derivePmccMarketSession(now) !== 'open';
}
