// lib/testing/fixedClock.ts
//
// CI-FLAKY-0002 -- a pinned-clock test helper so date-boundary tests don't flake based on what time
// of day CI happens to run. Only `Date` is faked (never timers), so promise/setTimeout behavior in
// UI tests using these helpers is unchanged.
//
// Use in a file that has day-boundary assertions: call `pinClock(...)` in `beforeEach` and
// `unpinClock()` in `afterEach`. Build test dates with `isoDateFromNow(n)` instead of
// `new Date(); d.setDate(d.getDate() + n)` -- the local-date-then-UTC-slice pattern that caused the
// original flake (see the ticket for the exact mismatch against the product's `daysUntil` basis).

import { vi } from 'vitest';

/** Pins `Date` (and only `Date`) to the given instant. Call `unpinClock()` afterward. */
export function pinClock(iso: string): void {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(iso));
}

/** Restores real timers after a `pinClock` call. */
export function unpinClock(): void {
  vi.useRealTimers();
}

/**
 * The UTC calendar date `days` from the currently pinned (or real) "now", as `YYYY-MM-DD`.
 * Deliberately mirrors how test fixtures build expiry/earnings dates elsewhere in this file set --
 * the fix is pinning the clock, not changing this UTC-slice construction itself.
 */
export function isoDateFromNow(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}
