// lib/entry-context/evidenceAsOf.ts
//
// The "as of" time recorded with the scan-derived evidence in an entry snapshot (underlying price, delta,
// IV, IVR, expected move, earnings date, quotes). An evidence value with no time is recorded as
// UNAVAILABLE, so a missing time silently blanks the whole snapshot. Only one scan path stamps a quote
// time on its candidates (spread-finder); Ranked and Targeted candidates do not. The values in those
// snapshots still came from the scan, so the scan's completion time is an honest fallback.

const iso = (ms: unknown): string | null =>
  typeof ms === 'number' && Number.isFinite(ms) && ms > 0 ? new Date(ms).toISOString() : null;

/** The candidate's own quote time when it has one, otherwise when the scan that produced it completed. */
export function entryEvidenceAsOf(quoteFetchedAt: unknown, scanCompletedAt: unknown): string | null {
  return iso(quoteFetchedAt) ?? iso(scanCompletedAt);
}
