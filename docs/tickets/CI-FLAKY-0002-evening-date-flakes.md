# CI-FLAKY-0002 — Evening date flakes in scan tests

**Status:** Draft (Paul), 2026-09-26. Test-only change; no product behavior changes. Quinn reviews.
**Related:** CI-FLAKY-0001 (cold-start warm-ups), EARNINGS-DATEBASIS-0001 (known temporary split: expiration-window DTE still uses the old `daysUntil` basis), `29db9b3` (fixed two evening flakes in the Positions workspace tests).

## Problem

`lib/scans/__tests__/ccConfigTruthfulness.test.ts` fails when CI runs late in the UTC day and passes again after 00:00 UTC. Five docs-only pushes to `main` on 2026-09-26 between 00:02 and 00:24 UTC went red (CI runs 183–187); `29db9b3` fixed two other tests with the same cause. Red builds on docs-only commits hide real failures and cost a re-run each time.

## Cause

The test and the code under test count days differently:

- **The test** builds expiry and earnings dates with `isoDate(n)`: local `setDate(getDate() + n)`, then `toISOString().slice(0, 10)`. That is a UTC calendar date.
- **The code** (`covered-call-finder.ts:36`, and `scan-utils.ts` `daysUntil`) computes DTE as `Math.round((UTC midnight of the date − now) / 1 day)`. After 12:00 UTC, a date `n` days out rounds to `n − 1`. Contracts then drop out of the DTE window, and the earnings boundary cases at 30, 31, 37 and 39 days flip.

The product side is the known split recorded in EARNINGS-DATEBASIS-0001 and needs its own ticket. This ticket only makes the tests deterministic.

The same `setDate(getDate() + n)` pattern appears in about 20 test files, including `csp*`, `cc*`, `covered-call-finder`, `scanAlign*`, `pmccStopGtcPrompt` and several `app/screener/__tests__` files. Only the files with day-boundary assertions fail.

## Scope

1. **Reproduce first (Quinn's rule).** Run `ccConfigTruthfulness.test.ts` with the clock pinned at `2026-06-15T23:30:00Z` and confirm it fails; then pin at `06:00Z` and confirm it passes.
2. **Add one helper,** `lib/testing/fixedClock.ts`:
   - `pinClock(iso)`: `vi.useFakeTimers({ toFake: ['Date'] })` plus `vi.setSystemTime`.
   - `isoDateFromNow(days)`: derives the date from the pinned clock.

   Only `Date` is faked, so promise and timer behavior in UI tests is unchanged.
3. **Sweep.** Run each file in the list above at two pinned times, `23:30Z` and `00:30Z`. Apply `pinClock('2026-06-15T06:00:00Z')` in `beforeEach` (with `vi.useRealTimers()` in `afterEach`) to every file that fails at either time. Files that pass both stay untouched.
4. **Guard.** Add a CI step that runs `lib/scans/__tests__` a second time with `FAKE_NOW=2026-06-15T23:30:00Z`, read by a Vitest setup file. That keeps the evening case tested every push, not just when someone pushes at night.

## Non-goals

- No change to `daysUntil`, `covered-call-finder.ts` or any product date math. The NY-basis DTE migration is a separate ticket, and it will need Ian because it moves the DTE window.
- No skipped, retried or quarantined tests.

## Acceptance criteria

1. `ccConfigTruthfulness.test.ts` fails at `23:30Z` before the change and passes at `06:00Z`, `23:30Z` and `00:30Z` after it.
2. Every file changed by the sweep passes at all three pinned times.
3. The full suite passes locally and in CI, and the new evening pass is green.
4. No test assertion values change; only how "now" is set.

## Estimate

Small: one helper, one setup file, one CI step, and edits to the files that fail the sweep (expected 3 to 6).
