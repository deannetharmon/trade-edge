// lib/indicators/completedBars.ts

// RSI-ENTRY-0001 slice P: daily closes from /api/chart bars with the still-forming bar removed.
//
// Yahoo returns today's partial bar while the US market is open (and sometimes before the open), so an RSI computed
// from every returned close repaints all day. This helper drops that one bar so the RSI uses completed daily bars only.
//
// Rules (Alan's spec):
//  * Only the LAST bar can be incomplete. It is dropped when its New York calendar date is today's New York date and
//    the New York time is before 16:00. At 16:00 exactly the regular session is over and the bar is kept.
//  * Half days (13:00 ET closes) are not in a calendar here, so between 13:00 and 16:00 on a half day the finished bar
//    is dropped. That errs toward the previous completed bar; it never uses a forming bar.
//  * A bar dated after today (clock skew) fails closed, as does any malformed input. Nothing is repaired or skipped,
//    because skipping a bar would shift the spacing RSI depends on.
//  * Bar timestamps `t` are Unix SECONDS, as /api/chart returns them (the session open, 9:30 ET).
// Pure: the clock is a parameter.

const NY_TIME_ZONE = 'America/New_York';

/** Regular session end in New York minutes after midnight (16:00). */
export const MARKET_CLOSE_ET_MINUTES = 16 * 60;

const nyFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: NY_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

interface NyMoment {
  /** YYYY-MM-DD on the New York calendar. */
  date: string;
  /** Minutes after New York midnight. */
  minutes: number;
}

function nyMoment(ms: number): NyMoment | null {
  if (!Number.isFinite(ms)) return null;
  const when = new Date(ms);
  if (Number.isNaN(when.getTime())) return null;
  const part: Record<string, string> = {};
  for (const piece of nyFormatter.formatToParts(when)) part[piece.type] = piece.value;
  const hour = Number(part.hour) % 24; // some engines print midnight as "24"
  const minute = Number(part.minute);
  if (!part.year || !part.month || !part.day || !Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  return { date: `${part.year}-${part.month}-${part.day}`, minutes: hour * 60 + minute };
}

/**
 * Finite closes (oldest first) of the COMPLETED daily bars, or null when the input cannot be trusted.
 * `bars` is the `bars` array from /api/chart: objects with a Unix-seconds `t` and a close `c`.
 * An empty array, or a single still-forming bar, returns [] (nothing to compute from).
 */
export function completedDailyCloses(bars: unknown, now: Date = new Date()): number[] | null {
  if (!Array.isArray(bars)) return null;
  const nowMoment = nyMoment(now.getTime());
  if (!nowMoment) return null;

  let previousT = -Infinity;
  const stamps: number[] = [];
  const closes: number[] = [];
  for (const bar of bars as unknown[]) {
    if (typeof bar !== 'object' || bar === null) return null;
    const { t, c } = bar as { t?: unknown; c?: unknown };
    if (typeof t !== 'number' || !Number.isFinite(t) || t <= 0) return null;
    if (typeof c !== 'number' || !Number.isFinite(c) || c <= 0) return null;
    if (t <= previousT) return null; // unsorted or duplicate
    previousT = t;
    stamps.push(t);
    closes.push(c);
  }

  if (closes.length === 0) return [];
  const last = nyMoment(stamps[stamps.length - 1] * 1000);
  if (!last) return null;
  if (last.date > nowMoment.date) return null; // dated after today: clock skew
  if (last.date === nowMoment.date && nowMoment.minutes < MARKET_CLOSE_ET_MINUTES) closes.pop();
  return closes;
}
