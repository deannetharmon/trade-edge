# SCREENER-CONFIG-0001 — Filter mode: finish the removal, fix CSP's leftover default

## Status

**Decided and implemented 2026-09-21.** Not a "reinstate Filter" ticket — the opposite.

## Background

`FILTER-MODE-REMOVAL-0002` (commit `3e8d9491`, Sept 11) hid Filter from the shared `ScanModeRadioGroup` used by every scan launcher, and explicitly deferred full code deletion: *"Filter's results rendering is entangled with CSP's own path in several places and needs a careful separate pass."* Three tests were left `.skip`/`.todo`, pending this ticket.

That "separate pass" turned out to be necessary: the removal was incomplete. Spreads' launcher (`RunModeModal`) was coerced away from a stale `'filter'` default at the same time; CSP's own modal (`CspScanModal`, sharing the same radio group) was not. CSP's `lastCspMode` stayed hardcoded to `'filter'`, so every fresh session silently opened the CSP scan modal in Filter mode with neither visible radio button (Rank/Targeted) showing as selected — confirmed directly against the real app (screenshot, fresh page load, no incognito needed since the value was never persisted to localStorage in the first place).

## Decision

Dean confirmed 2026-09-21: Filter mode is not wanted back, for Spreads or for CSP. Finish what the hide-first commit deferred, for CSP specifically (Spreads was already correct).

## What changed

1. **`app/screener/page.tsx`** — `lastCspMode`'s default changed from `'filter'` to `'rank'`, matching Spreads' existing coercion. CSP now behaves identically to every other strategy: opens in Rank by default, Filter is not offered and not reachable.
2. **A real bug this exposed, fixed in the same file** — `cspNonFilterSession` (which routes CSP's post-scan filter chips through `applyFilterModeChips` or bypasses it) still excluded Rank mode, even though CSP's result-controls panel already renders in Rank mode (an earlier, separate parity fix). With Filter silently the default, nobody had hit this: every POP/OTM/DTE/Delta/credit-ratio chip on a Rank-mode CSP scan was fully interactive but silently filtered nothing. Now that Rank is CSP's only reachable mode, this would have been hit on every single CSP scan. Fixed to mirror the panel's own render condition: chip filtering now applies exactly when the chip panel is visible (Filter or CSP+Rank), matching intent already established elsewhere in the code.
3. **Test cleanup**, matching the decision:
   - `app/screener/__tests__/CspCandidateDiscovery.test.tsx`: the `.todo` "pending SCREENER-CONFIG-0001" line replaced with a real, passing test confirming CSP defaults to Rank with no Filter option.
   - `app/screener/__tests__/ScreenerUXHierarchy.test.tsx`: two Spreads-launcher `.skip` tests removed (permanently unreachable: `FIND SPREADS → RUN SCREENER` cannot reach Filter mode, and Dean confirmed it's not coming back). One narrow-viewport test's coverage is an honest, stated gap, not silently replaced. A third, previously-passing test in the same file (CSP's Filtered-mode hierarchy) was updated to exercise CSP's Rank mode instead, since that's now the only reachable default — its real coverage (hierarchy order, CSP-vs-spread badge isolation) is preserved, not dropped.
   - `app/screener/__tests__/UnifiedStrategyLauncher.test.tsx`: one existing test that explicitly asserted the old `'filter'` default updated to assert `'rank'`.

## Explicitly out of scope

- **Covered Calls** (`runCcScan`) and the held-candidates (LEAPS/PMCC) scan path both unconditionally use `'filter'` as their only mode, by original design — they never offered Rank/Targeted. Not touched; not affected by this decision.
- **Full deletion of Filter's rendering code** remains deferred, same as the original hide-first commit — CSP's Filter-mode result rendering still technically exists (dead code, unreachable from any launcher now), consistent with "hide-first, delete carefully later" rather than a blind sweep.

## Verification

- `tsc --noEmit` with the real `tsconfig.json`: 0 errors.
- Full `app/screener`, `features/screener`, `lib/scans` suite: **68 files, 696 tests passed, 0 failed.**
- The mode-default fix was verified against the real app first (screenshot showing neither Rank nor Targeted selected on a fresh load), before any code was written.
