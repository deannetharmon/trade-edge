# CSP stale-balance correction — Implementation Report

**Source:** cherry-picked, hand-applied intent of `568bd0d6` (`fix(csp): use fresh selected-account capital`) from `feature/lcc-0001-positions-workspace-redesign`, against current `main`.
**Base:** `main` @ 408dcac

## What this does NOT include, and why

- **No multi-account picker.** The source commit added a per-scan account dropdown to `CspScanModal`. `main` has since built a single app-wide active-account control (`lib/tastytrade/accountSelection.ts`, the picker in the header). Adding a second, scan-local picker would conflict with it. Checked: `getCspCapitalContext` on `main` already resolves capital through that same app-wide resolver (`resolveActiveBrokerAccount`), so multi-account users are already covered without any new UI — they just need to have chosen their account once in the header control.
- **No `getPmccBrokerSnapshot` / `pmcc-foundations.ts`.** The second commit (`4266f24d`) exists only to fix a build break caused by an unused PMCC function inside the CSP commit. Since that function isn't ported, its dependency isn't needed either.
- **`getCspCapitalContext`'s signature is unchanged** (no `selectedAccountId` parameter) — it already reads the active account from the app-wide resolver.

## What this DOES include

1. Retired the saved/typed-in CSP cash override (`cspCashOverride`, `handleCspCashChange`, the "CSP SETTINGS" panel, `LS_CSP_CASH` is now cleared instead of read). CSP capital only ever comes from a fresh broker balance fetch.
2. Added post-scan CSP result filters: a minimum-DTE chip and a delta-range chip in `FilteredResultControls`, wired into the CSP results view in `app/screener/page.tsx`. Display-only; they cannot change what was scanned.
3. Updated the insufficient-capital wording from "Insufficient cash" to "Insufficient CSP capacity", with a fuller explanation of how capacity is computed.

## Files touched

- `app/screener/page.tsx`
- `features/screener/components/FilteredResultControls.tsx`
- `features/screener/components/__tests__/FilteredResultControls.test.tsx`
- `lib/scans/csp-finder.ts`

## Verification

- `tsc --noEmit` with the real `tsconfig.json` (es5): 0 errors.
- `next build` (sandbox, Google Fonts mocked): compiled successfully.
- Targeted test run (everything under `app/screener`, `features/screener`, plus the CSP capital-context tests): **26 files, 241 tests passed, 2 skipped, 1 todo, 0 failed.**
- Full repo-wide `vitest run` was not completed this session (see chat) — not needed for a change scoped to these 4 files; CI runs the full suite on push per ways-of-working.md.

## Follow-up for Dean

If CSP scans still come back with no capital after the active account is explicitly chosen in the header account control, that would point at the balance fetch itself, not this logic — worth a fresh look then.
