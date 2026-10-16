# SCAN-MODAL-UX-0002B: Spreads scan modal on one screen

Status: IMPLEMENTED 2026-10-15. Follows SCAN-MODAL-UX-0002A. Mock: https://claude.ai/artifact/9BtamTZVrNomPzBA2kNFcy

## Problem
The Spreads scan modal (Rank and Targeted) is the tallest modal in the app; Targeted needed two to three screens and scrolled. It also looked different from the Covered Call, CSP, PMCC and LEAPS modals.

## Change (presentation only)
- New `SpreadsScanModal.tsx` draws the modal: compact Rank / Targeted selector, one-row preset selector, a colored dot per setting, one legend line, help text in "i" tooltips (text stays in the page), a short recap, Cancel beside RUN SCREENER.
- Targeted: DTE range and Spread widths on one row; Min credit / risk, POP est. min, Min OTM and Min IVR as a two-by-two grid with their quick selects. The IVR stocks/ETFs guide and the Iron Condor OTM note stay visible in short form; the full sentences are in tooltips.
- Rank: Spread widths and the read-only Active ruleset strip (same values as before, same test id `rank-active-rules-preview`).
- `RunModeModal` in `page.tsx` keeps its state, `applyTargetedPreset` (same preset effects: IVR, DTE, credit/risk from the preset; POP 70 and OTM 6), every clamp (POP 50 to 95, OTM 0 to 30, IVR 0 to 100, credit/risk 0 to 100, DTE max above min) and the run request.
- The Filter-mode preset list is kept and passed in (Filter is not offered in the mode selector, FILTER-MODE-REMOVAL-0002).

## Not changed
Gates, defaults, thresholds, presets, scan engine, results pages, run request. Input accessible names are unchanged.

## Verification
- `tsc -p tsconfig.check.json` clean; new `SpreadsScanModal.test.tsx` (10 tests); `app/screener` and `features/screener` suites pass; full suite run before push.
- Measured in a real browser at 720 px: Targeted 500 px, Rank 356 px (limit 644 px at a 700 px viewport).

## Test-only fix found on the way
`PositionsWorkspace.test.tsx` and `StockHoldingsSellButton.test.tsx` built a "40 days out" earnings date from clock arithmetic and failed (39d vs 40d) when run in the late evening US Mountain time (after midnight New York, across the November clock change). They now add whole calendar days to the New York date, the basis the app uses. No app code changed.
