# CI-FLAKY-0002 — Evening date flakes in scan tests

**Status:** Approved by Dean 2026-09-27. Test-only change; no product behavior changes.
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


## Build notes (2026-09-27)

**Honest result of step 1 (reproduce first, Quinn's rule):** `ccConfigTruthfulness.test.ts` did NOT reproduce at any pinned hour tested (00:02Z, 00:24Z — the exact historical failure times — plus 12:00Z, 13:00Z, 18:00Z, 23:30Z, 23:59Z, all on 2026-06-15). Rather than force a speculative fix onto a file that currently passes everywhere, the sweep in step 3 was skipped: no product-adjacent test file was edited.

**What was built instead**, matching steps 2 and 4 of the scope (still real, still useful, does not require the disproven step 3):
- `lib/testing/fixedClock.ts` — `pinClock`/`unpinClock`/`isoDateFromNow`, exactly as specified. 5 tests.
- `vitest.setup.ts` — when the `FAKE_NOW` environment variable is set, pins the clock for every test in that run (only `Date`, never timers). No-op when unset; the normal `npm test` run is unaffected (confirmed: full suite passes both with and without `FAKE_NOW`).
- `.github/workflows/ci.yml` — a second CI step, "Tests (evening UTC clock guard)", re-runs `lib/scans/__tests__` with `FAKE_NOW=2026-06-15T23:30:00Z`. All 74 files / 1087 tests in that directory pass under it today.

This is a guard against a recurrence, not a fix for a reproduced bug — because none reproduced. If the evening flake returns, this CI step will go red on the exact push that reintroduces it, with a clear cause (the pinned run) rather than a confusing, unrepeatable red build. If it's still silent after a few weeks, the guard step can be narrowed or dropped; it is cheap (adds well under a minute to CI).

**Open question for Quinn:** was the original flake perhaps already fixed by `29db9b3` (which the ticket already credits with fixing two other evening flakes) touching something more broadly than just the Positions workspace tests? Worth a quick look before assuming the underlying cause is fully gone rather than just not reproduced today.
