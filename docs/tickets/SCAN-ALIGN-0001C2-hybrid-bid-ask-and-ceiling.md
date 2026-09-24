# SCAN-ALIGN-0001C2 — Hybrid bid/ask policy with absolute reject ceiling

## Status

**Accepted by Dean 2026-09-24 (ceiling $0.50, scoped to short calls). Not built.** Build order slot 4. PR3, commit 2 of 2, after C1. Needs mock 2 (Diane) approved and Alan's integer-cents pass. Full suite and Vercel preview required.

## Problem

Covered call uses a fixed $0.20 width cap: it passes 50% slippage on cheap calls and blocks 3% on expensive ones. PMCC uses percent-only bands, with no one-tick floor.

## Scope

- One shared function in `lib/scans/` used by both `isEligibleCcLeg` and `evaluatePmccQuoteQuality`, so the two cannot drift.
- Reject if `width > max($0.05, 10% of mid)`. Warn if `width > max($0.05, 5% of mid)`. Strict `>`; equality passes. No one-tick floor for mids under $0.10.
- Compare in **integer cents** (or round to 1e-6): `0.33 − 0.28 = 0.05000000000000004` must not reject.
- **Absolute reject ceiling: $0.50 per share**, applied to the **covered-call leg and the PMCC short leg only**. New PMCC LEAP legs keep the percent-only policy, because a $100 LEAP mid at 2% is a $2.00 width and would otherwise reject nearly every new-entry long. The ceiling is a scan control with a new field name; the shared `BID_ASK_MAX` key (used by CSP and `lib/screener.ts` with a different meaning) must not be renamed or reused.
- Crossed quotes reject; locked markets pass; bid 0 handled by the existing `finitePositive` ordering so mid = 0 cannot occur. `spreadPct` stays display-only.
- The old $0.20 cap is removed. **Saved-value migration:** CC rules are not persisted (`page.tsx:8912-8916`), so no saved $0.20 exists for CC; the new default takes effect directly. Add a **changelog line** and a **static UI hint** on the control (no dismissible migration note needed). The PMCC modal persists `maxSpreadPct` (`LS_PMCC_DTE`); its unit does not change.
- After-hours CC: display state "not ready" is **held** (see below).

## Non-goals

- Changing the ceiling on LEAP legs. Making the ceiling scale by role.
- The after-hours "not ready" chip: held until Ian confirms his open item 2 (Dean's answer: the 21-DTE stop, 50% profit exit and 2x credit stop apply to the short leg).

## Acceptance criteria (Alan's fixtures)

- 0.28/0.33 pass; 5.75/6.25 warn; 0.95/1.05 (exactly 10%) pass; 0.95/1.0501 reject; 0.30/0.30 locked passes; crossed rejects; bid 0; $0.10 mid with $0.05 width passes reject but shows the wide warning; a $20 mid with a $2.00 width rejects at the ceiling on a short.
- A $100 LEAP with a 2% width is still eligible (ceiling scope regression).
- CC and PMCC give the same reject and warn status for the same leg through the shared function (`it.each` parity test).
- `validateCc` rejects a non-finite, negative or sub-tick ceiling.

## Implementation notes

- Tests that flip: `ccConfigTruthfulness.test.ts` "max bid/ask width is a real, absolute dollar setting" (both tests; 1.0/1.21 and 1.0/1.4 encode the old rule, 1.0/1.2 also rejects under the hybrid); its pinned lifecycle map and "fixed criteria" list if a control id changes. `covered-call-finder.test.ts` 14c: rationale only. `pmccQuoteQuality.test.ts` percent-band tests: unchanged if the ceiling does not apply to LEAP legs. Verify `ScreenerPage.test.tsx` 682-725 ("Max spread %") belongs to which scan.
- `CcRulesType` derives from `DEFAULT_CC_RULES` (`constants.ts:52`), `ccRegistry.ts:272`, `page.tsx:8916`. tsc will not catch a stray reuse of `BID_ASK_MAX`.
- Diane: control label and unit, mock 2.

## Validation steps

`tsconfig.check.json` tsc, full suite, Vercel preview.

## Rollout notes

Revertable as its own commit. The new field is additive; a revert leaves an unknown key that loaders must tolerate.
