// RECO-UNIFY-0001C: detect positions that have closed, so the disagreement log can fill in outcomes.
// A position counts as closed only after it is missing from CLOSE_AFTER_MISSES consecutive successful
// refreshes (guards against a partial broker fetch). The P/L is the last value seen while open.
export const CLOSE_AFTER_MISSES = 2;

export interface TrackedPosition { lastSeenPnl: number | null; missing: number }
export type ClosedTracker = Record<string, TrackedPosition>;
export interface ClosedPosition { positionKey: string; lastSeenPnl: number | null }

export function updateClosedTracker(
  tracker: ClosedTracker,
  live: ReadonlyArray<{ key: string; pnl?: number | null }>,
): { tracker: ClosedTracker; closed: ClosedPosition[] } {
  const next: ClosedTracker = {};
  const liveKeys = new Set<string>();
  for (const p of live) {
    liveKeys.add(p.key);
    const pnl = typeof p.pnl === 'number' && Number.isFinite(p.pnl) ? p.pnl : null;
    next[p.key] = { lastSeenPnl: pnl ?? tracker[p.key]?.lastSeenPnl ?? null, missing: 0 };
  }
  const closed: ClosedPosition[] = [];
  for (const [key, prev] of Object.entries(tracker)) {
    if (liveKeys.has(key)) continue;
    const missing = prev.missing + 1;
    if (missing >= CLOSE_AFTER_MISSES) closed.push({ positionKey: key, lastSeenPnl: prev.lastSeenPnl });
    else next[key] = { lastSeenPnl: prev.lastSeenPnl, missing };
  }
  return { tracker: next, closed };
}
