# CSP result view: default to the scan's own preferred delta band — Implementation Report

**Trigger:** Dean asked whether Find CSP needed a pre-scan POP filter, after the scoring/gate fix (0b807be0) left legitimate-but-out-of-band deep-ITM/low-POP contracts still visible by default in the result list (correctly — they were never meant to be hidden entirely, only kept out of Best Opportunities).
**Reviewed by (voiced team lens):** Ian — "default the result view to the scan's own rules; delta alone fixes the POP problem since POP = 1 − delta."
**Base:** `main` @ 0b807be0

## What changed

`app/screener/page.tsx` only. The CSP result view's Delta chip now defaults to the active scan's own `ruleSnapshot.deltaMin`/`deltaMax` (the same band already published as "ACTIVE CSP RULES" above the results) instead of defaulting to "Any." One-click override, including an explicit "Any" to see everything, and "Reset result filters" returns to true Any — consistent with how every other result chip already behaves.

Implementation: `filterCspDeltaRange` (the raw override) is now paired with a `filterCspDeltaTouched` flag. Until the user interacts with the Delta chip at all (including picking "Any" itself), the effective filter falls back to the scan's own preferred band; any explicit interaction wins from then on.

## Scope decision I did NOT make unilaterally

Ian's original ask also included defaulting the **Put OI** minimum to 100 (from "Any"). I did not build that: `filteredMinOi` is shared state across CSP, CC, PMCC, and spreads' result views — changing its default would silently change the default OI floor for every strategy, not just CSP, which nobody signed off on. Flagging back to the team rather than guessing: does this need a CSP-only OI-floor state distinct from the shared `filteredMinOi`, or is a shared default change actually fine? Left at "Any" for now, unchanged.

## Verification

- Before writing any test, I directly rendered the real page with a mixed-delta AMD-style fixture (two strikes inside the 0.15–0.25 balanced-preset band, one outside) to confirm actual behavior rather than trust a static read of a 12,000-line file — this caught nothing wrong this time, but it's the same caution that caught the OI-gate scoping mistake earlier in this thread, so I kept using it.
- `tsc --noEmit` with the real `tsconfig.json` (es5): 0 errors.
- New test file `app/screener/__tests__/CspDefaultDeltaFilter.test.tsx` (5 tests, all against the real rendered page, not mocked internals):
  1. All 3 fixture strikes market-qualify; the default view shows only the 2 inside the preferred band ("Showing 2 of 3").
  2. The Delta chip shows "0.15–0.25" pre-selected with a removable filter chip, with no click required.
  3. Clicking "Any" reveals the previously-hidden strike ("Showing 3 of 3").
  4. An explicit narrower choice (0.30–0.45) always wins over the default.
  5. "Reset result filters" returns to true Any, not back to the scan's band — consistent with every other chip's reset behavior.
- Full targeted CSP/screener suite (existing + new): **29 files, 296 passed, 2 skipped, 1 todo, 0 failed.**

## Open item for the team

Put OI default (100 vs the current "Any") — needs a decision on whether it's CSP-only or genuinely shared across strategies before I build it.
