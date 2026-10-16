# SCAN-MODAL-UX-0002A: PMCC and LEAPS scan modals on one screen

Status: IMPLEMENTED 2026-10-15. Follows SCAN-MODAL-UX-0001 (CC and CSP). Mock: https://claude.ai/artifact/9BtamTZVrNomPzBA2kNFcy

## Problem
The PMCC scan modal was taller than a 700 px laptop screen and scrolled. The LEAPS modal fit, but looked and read differently from the Covered Call and CSP modals. PMCC listed none of its fixed rules.

## Change (presentation only)
- Same system as SCAN-MODAL-UX-0001: one colored dot per setting, one legend line, help text in "i" tooltips (text stays in the page), a short recap by the buttons, Cancel beside Run.
- PMCC: DTE range, Delta range (quick selects `Δ .15–.25`, `Δ .20–.30`, `Δ .25–.35`), Max bid/ask width (% of mid and $ cap on one row), Short OI pref. Held LEAPS chips, loading, empty and nothing-selected messages behave as before.
- PMCC "Always applied" strip, read from `pmccPairing.ts` and `pmccDecision.ts`: short strike above price, two-sided quote, earnings before expiry excluded, net debit below width, held LEAP exempt, no short OI = rejected.
- LEAPS: DTE range is the search range; Delta range, OI min and Max extrinsic are marked "Adjust after scan" (result filters). The legend says which needs a new scan.
- `ScanLegend` takes an optional closing `note`; the default is unchanged.

## Not changed
Run request shape, defaults, validation, thresholds, engine, results pages. Input accessible names (`Min DTE`, `Max DTE`, `Min Δ`, `Max Δ`, `Max spread %`, `Width ceiling ($)`, LEAPS names) are unchanged except the rename below.

## Wording decisions (Ian)
- "Short OI min" becomes "Short OI pref.": the engine keeps a call below the minimum and flags it (`pmccDecision.ts`).
- PMCC delta chip format matches CC (`Δ .20–.30`).

## Verification
- `tsc -p tsconfig.check.json` clean; targeted tests 30 files / 327 tests; new `LeapsScanModal.test.tsx`, expanded `PmccScanModal.test.tsx`.
- Measured in a real browser at 720 px: PMCC 456 px, no held LEAPS 494 px, nothing selected 505 px, LEAPS 341 px (limit 644 px at a 700 px viewport).
