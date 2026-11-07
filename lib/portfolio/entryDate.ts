// lib/portfolio/entryDate.ts

// STOCK-RSI-0001 slice B1 -- validation for the user-set entry date of a held stock. Pure; the clock is a parameter.

/** Earliest date accepted (well before any usable chart history; stops typos like 0202-01-01). */
export const ENTRY_DATE_MIN = '1990-01-01';

/** Null when `value` is an acceptable YYYY-MM-DD real calendar date, not in the future; otherwise the reason. */
export function validateEntryDate(value: unknown, now: Date = new Date()): string | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return 'Entry date must be YYYY-MM-DD';
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) return 'Entry date is not a real date';
  if (value < ENTRY_DATE_MIN) return 'Entry date is too far back';
  // One day of slack so a New York date is never rejected for being "ahead" of UTC.
  const limit = new Date(now.getTime() + 24 * 3600 * 1000).toISOString().slice(0, 10);
  if (value > limit) return 'Entry date cannot be in the future';
  return null;
}
