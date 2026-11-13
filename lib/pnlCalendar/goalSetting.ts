// lib/pnlCalendar/goalSetting.ts
//
// GOAL-0001: the monthly return goal (percent of the month's starting account value), shared by the P/L Calendar tab and the
// Performance report so one setting drives both. Default 5%. Stored per viewer in the browser, under the same key the P/L Calendar
// already used, so an existing target carries over.

export const GOAL_TARGET_KEY = 'tradeedge-pnl-calendar-target-pct';
export const DEFAULT_GOAL_TARGET_PCT = 5;
export const GOAL_TARGET_MIN_PCT = 0.5;
export const GOAL_TARGET_MAX_PCT = 50;

/** A usable target percent, or null when the value is missing, not a number, or outside 0.5 to 50. */
export function parseGoalTargetPct(raw: unknown): number | null {
  if (raw == null || raw === '') return null;
  const v = typeof raw === 'number' ? raw : Number(raw);
  return Number.isFinite(v) && v >= GOAL_TARGET_MIN_PCT && v <= GOAL_TARGET_MAX_PCT ? v : null;
}

type Reader = Pick<Storage, 'getItem'>;
type Writer = Pick<Storage, 'setItem'>;

function browserStorage(): Storage | null {
  try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; }
}

export function readGoalTargetPct(storage: Reader | null = browserStorage()): number {
  try { return parseGoalTargetPct(storage?.getItem(GOAL_TARGET_KEY)) ?? DEFAULT_GOAL_TARGET_PCT; } catch { return DEFAULT_GOAL_TARGET_PCT; }
}

/** Saves a valid target; returns the value now in effect (the old one is kept when the new one is not valid). */
export function writeGoalTargetPct(raw: unknown, storage: (Reader & Writer) | null = browserStorage()): number {
  const v = parseGoalTargetPct(raw);
  if (v == null) return readGoalTargetPct(storage);
  try { storage?.setItem(GOAL_TARGET_KEY, String(v)); } catch { /* per-viewer convenience only */ }
  return v;
}
