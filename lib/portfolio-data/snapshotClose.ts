// lib/portfolio-data/snapshotClose.ts
//
// LEAPS-SPARK-0003: the daily position snapshot is the first reading of the day. After the market closes the app also records that day's
// closing reading as `close` on the same snapshot, without touching the first reading (the stop-breach logic reads those fields as recorded).
// The History lines prefer `close` when a day has one. Pure so the route and the tests share one rule.

export interface SnapshotClose { currentValue: number | null; netDelta: number | null; stockPrice: number | null; capturedAt: string }

/** Regular session closes 4:00 pm New York; wait until 4:05 so the last marks have settled. Weekdays only (holidays just record a repeat of the last close). */
export const CLOSE_CAPTURE_AFTER_MINUTES = 16 * 60 + 5;

export function isAfterMarketCloseNy(nowMs: number): boolean {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short', hour: 'numeric', minute: 'numeric', hour12: false }).formatToParts(new Date(nowMs));
  const get = (type: string) => parts.find(p => p.type === type)?.value ?? '';
  const weekday = get('weekday');
  if (weekday === 'Sat' || weekday === 'Sun') return false;
  const minutes = (Number(get('hour')) % 24) * 60 + Number(get('minute'));
  return minutes >= CLOSE_CAPTURE_AFTER_MINUTES;
}

interface HasDate { date: string; close?: SnapshotClose | null }

/**
 * Records the close on the snapshot for `snapshot.date`: the first post-close capture wins (so a later reload cannot move it), the first
 * reading is left exactly as recorded, and a day with no snapshot yet gets one carrying the close.
 */
export function applyClose<T extends HasDate>(existing: T[], snapshot: T, close: SnapshotClose): { list: T[]; changed: boolean } {
  const index = existing.findIndex(item => item.date === snapshot.date);
  if (index >= 0) {
    if (existing[index].close) return { list: existing, changed: false };
    const list = existing.slice();
    list[index] = { ...existing[index], close };
    return { list, changed: true };
  }
  return { list: [...existing, { ...snapshot, close }], changed: true };
}
