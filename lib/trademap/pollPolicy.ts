// lib/trademap/pollPolicy.ts
//
// OPTMAP-0001 S7: when the Trade Map keeps polling the broker, and how it labels quotes that are old because the market is
// closed. Every poll is two calls through the app's server (stock quote + option quotes), so nothing polls on a timer when
// no quote can change (market closed) or nobody is looking (hidden tab). The 5 s cadence is unchanged while the market is open
// and the tab is visible, because the Send button's data gate depends on it.

/** True when the page should poll on a timer; otherwise it makes one fetch per leg change. */
export function shouldPollOnTimer(i: { marketOpen: boolean; tabVisible: boolean }): boolean {
  return i.marketOpen && i.tabVisible;
}

/** "MARKET CLOSED" instead of "STALE" when quotes are old only because the market is closed (the gate itself is unchanged). */
export function isClosedMarketStale(gateStatus: 'live' | 'warming' | 'stale', marketOpen: boolean): boolean {
  return gateStatus !== 'live' && !marketOpen;
}

/** "Nov 17, 4:00 PM ET" for the newest quote time, or null when there is none. */
export function formatQuoteTime(ms: number | null | undefined): string | null {
  if (ms == null || !Number.isFinite(ms) || ms <= 0) return null;
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true }).formatToParts(new Date(ms));
  const get = (t: string) => parts.find(p => p.type === t)?.value ?? '';
  return `${get('month')} ${get('day')}, ${get('hour')}:${get('minute')} ${get('dayPeriod')} ET`;
}
