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

## Golden fixtures (Alan, 2026-09-24) and Ian's rulings

**Build to the redrawn Mock 2 (`SCAN-ALIGN-0001-mocks-1-2-redraw.md`), not the original Mock 2.**

**Integer rules (no mid rounding):** convert with `Math.round(x * 10000)` (1e-4 dollar units, handles 3 to 4 decimal quotes). With w = ask - bid and S = ask + bid (= 2 x mid), in cents: reject iff `20w > max(100, S)`; warn iff `40w > max(200, S)`; ceiling (short and CC only) reject iff `w > 50`. (In 1e-4 units scale by 100: reject `20w > max(10000, S)`, warn `40w > max(20000, S)`, ceiling `w > 5000`.) The percent uses S/2 by cross-multiplication, never a mid rounded to cents.

| bid/ask | w | S | Result |
|---|---|---|---|
| 0.28/0.33 | 5 | 61 | pass, no warn (float trap 0.05000000000000004) |
| 5.75/6.25 | 50 | 1200 | pass + WARN (8.33%); ceiling 50 > 50 no |
| 0.95/1.05 | 10 | 200 | pass + WARN (exactly 10%) |
| 0.95/1.0501 | 10.01 | 200.01 | REJECT |
| 0.30/0.30 | 0 | 60 | locked, pass, spreadPct 0 |
| 0.31/0.30 | crossed | | reject |
| 0.00/0.10, 0.10/0.00, 0/0 | | | reject (`finitePositive`; mid = 0 unreachable) |
| 1.94/2.06 (mid 2.00, w 12) | 12 | 400 | **passes reject (limit max(5, 20)) and warns (limit max(5, 10))** (replaces the impossible row) |
| 0.075/0.125 (mid 0.10) | 5 | 20 | pass, **no warn** (Ian: no warn for mid <= $1.00; the $0.05 floor is a tick-noise allowance, not a quality signal; one floor, not two) |
| 0.06/0.14 (mid 0.10) | 8 | 20 | reject |
| 19.00/21.00 (mid 20) | 200 | 4000 | short/CC: REJECT by the ceiling only (percent passes) |
| 99.00/101.00 (LEAP mid 100) | 200 | 20000 | new PMCC long: eligible, no warn (ceiling not applied) |
| 96.00/104.00 (LEAP mid 100, 8%) | 800 | 20000 | eligible + WARN (proves ceiling scope) |
| 9.75/10.25 | 50 | 2000 | pass (ceiling 50 > 50 no) |
| 9.74/10.26 | 52 | 2000 | short reject by the ceiling |

**Old-rule flips:** 1.00/1.20 (w 20, S 220: 400 > 220 reject; the old $0.20 cap passed it); 1.00/1.21 and 1.00/1.40 reject; 0.10/0.30 (w 20, S 40: 400 > 100 reject; the old cap passed it). The old $0.20 default is gone: assert the new ceiling default 0.50 and that `DEFAULT_CC_RULES.BID_ASK_MAX` (`constants.ts:55`) no longer drives CC width; **the shared `BID_ASK_MAX` key stays untouched for CSP and rinse-repeat** (Dane renames the CC field).

**Parity `it.each`:** every row through the shared function, `isEligibleCcLeg` and `evaluatePmccQuoteQuality` (short role, open session, fresh timestamp, not delayed): reject equals `!structurallyUsable`; warn equals status `wide_warning`. `evaluatePmccQuoteQuality` has no role param today; the ceiling needs one (default = no ceiling), and the parity test must neutralise the earlier status precedence (too_wide, delayed, closed, missing ts, stale).

**`validateCc` does not exist on main (Alan B3): Dane creates it** with fixtures: NaN, +Inf, -Inf, -0.01, 0 and 0.004 reject; 0.01 and 0.50 accept; **a ceiling below the $0.05 floor (e.g. $0.03) is valid** (Ian: ticks are $0.01; effective limit is min(ceiling, reject rule); never clamp the ceiling up to the floor); reject ceiling <= 0, NaN or below $0.01.

**Ian's rulings:** Q1 accepted as above; Q2 the PMCC modal `maxSpreadPct` still overrides the 10% reject percent for shorts (keeping the $0.05 floor) and the 5% warn stays fixed; ceiling scope confirmed (CC leg and PMCC short only, not LEAP legs). Mock items: PMCC delta chips 0.15-0.25 / 0.20-0.30 / 0.25-0.35, CC presets 5/10/15% and $0.30/$0.50/$0.75 approved (the 5% preset sits at the warn line and shows no warn-only zone); hint reads "Warns above 5% of mid (or $0.05)"; CC "Max width" becomes "% of mid" with the "$0.50 Width ceiling" as a separate control, label showing reject = the percent rule and the ceiling caps it.

**Tests that flip:** `ccConfigTruthfulness.test.ts:87` both tests (1.0/1.2 now rejects; the 0.2-vs-0.5 toggle needs a wide-percent-safe row, e.g. a $20 mid with w 200); `covered-call-finder.test.ts:326` (14c) comment only; `ScreenerPage.test.tsx:682` "Max spread %" is the PMCC modal and is unrelated to the CC ceiling; `pmccQuoteQuality.test.ts` percent-band tests unchanged if the ceiling does not apply to LEAP legs.

**Gate: cleared.** Mock 2 (redrawn) approved by Ian; Dean delegated the approval to Ian (2026-09-24).
