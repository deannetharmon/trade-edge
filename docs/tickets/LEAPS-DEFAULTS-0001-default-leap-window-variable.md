# LEAPS-DEFAULTS-0001 — Default LEAP window is a variable: 12 to 18 months; PMCC short call 30 to 45 DTE

## Status

**Approved by Dean 2026-09-25 (Ian lens; Dean agreed to every recommendation). Built and pushed to `main` (full suite 373 files / 5473 tests, real `next build`).** Replaces a draft ticket "Refactor Screener LEAPs/PMCC constants into centralized context variables", which was reviewed and reworked.

## Why the original draft was not built as written

- Step 3 set `DEFAULT_RANK_CONFIG.dteSweetSpot` and `dteRange` to 450 and 90. Those belong to credit-spread and CSP rank scoring (full DTE score at 38 days, sliders limited to 14-45 and 1-14); the change would have zeroed the DTE score of every spread and CSP. LEAPS scoring deliberately has no DTE input (`leapsScore.ts`). Dropped.
- The delta constants duplicated `DEFAULT_PMCC_LONG_DELTA_RANGE`, which other code already reads. A second copy can drift. Dropped.
- The constants were to live at the top of `page.tsx`; config belongs in `lib`.
- Narrowing the shared `DEFAULT_PMCC_DTE_RANGES.longMin/longMax` (180/730) would have narrowed how the app recognizes and evaluates LEAPS already held (`pmccHeldReadinessClient.ts`, `pmccHeldLeaps.ts`, `pmccDecision.ts`, the positions workspace), and held LEAPS age below 365 days.

## What was built

- `lib/scans/leapsEntryTargets.ts`: `LEAP_ENTRY_DTE_TARGET = { min: 365, max: 545 }` (12 to 18 months) and the LEAPS DTE chip options. Change the numbers here and the LEAPS screen defaults and chips follow. 545, not 550, so the default lands on an existing chip.
- The LEAPS screen (and the long leg of new entries) starts at that window. `PMCC_LONG_DTE_MIN/MAX` in `page.tsx` now read from it; the two unused `PMCC_LONG_DTE_SWEET_*` constants were removed; the DTE chip rows read the lib chip lists.
- `DEFAULT_PMCC_DTE_RANGES.shortMin` 21 to 30 (max stays 45), so the PMCC short-call default is 30 to 45 DTE. A short call opened at 21 DTE is already at the 21-DTE management stop on day one. The wide held-LEAP bounds (180/730) are unchanged.
- `docs/PMCC_SPECIFICATION.md` marked superseded in part (its old ranges: LEAP 270-400 days and delta 0.78-0.88, short call delta 0.20-0.30).
- Tests: `leapsEntryTargets.test.ts` (target values, chips contain the ends, target inside the held bounds, short call 30-45); updated `pmccDteRanges.test.ts`, the PMCC scan defaults assertion in `ScreenerPage.test.tsx` (21 to 30), and `heldTradeReviewFloor.test.ts` (its short call moved from 25 to 32 DTE, since the server review now applies the 30-day floor).

## Behavior to know

- The LEAPS screen now hides contracts outside 365-545 days until you widen the DTE chips. The LEAPS scan fetch also starts at that window.
- Saved settings still win: anything saved on the scan-defaults page or in the PMCC scan modal is not overwritten.
- The server-side held PMCC short-call review (`serverTradeReview.ts`) uses the same short range, so a held-LEAP short call under 30 DTE is now blocked there, matching what the scan shows.
- Not changed: rank scoring, LEAPS scoring, delta ranges, the held-LEAP evaluation bounds, the portfolio `PMCC_LONG_DTE_MIN = 120` in `positionLifecycle.ts`.
