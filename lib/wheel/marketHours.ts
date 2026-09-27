// lib/wheel/marketHours.ts
//
// WHEEL-SYSTEM-0002 (W2) -- is the US options market open right now (New York time)? Options quotes outside regular hours can
// be stale or very wide, so the bid-ask check is not trusted then (open interest still is: it updates overnight).
//
// Regular hours only: Monday to Friday, 9:30 to 16:00 New York time. Exchange holidays are NOT known here, so on a holiday
// this says "open" and the bid-ask check still runs; the trader can widen the bid-ask limit in the adjustable defaults.

export function isMarketOpen(now: Date = new Date()): boolean {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short', hour: 'numeric', minute: 'numeric', hour12: false }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  const weekday = get('weekday');
  if (weekday === 'Sat' || weekday === 'Sun') return false;
  const hour = Number(get('hour')) % 24; // some engines return "24" at midnight
  const minutes = hour * 60 + Number(get('minute'));
  return minutes >= 9 * 60 + 30 && minutes < 16 * 60;
}
