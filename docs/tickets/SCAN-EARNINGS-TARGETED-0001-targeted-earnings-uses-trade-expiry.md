# SCAN-EARNINGS-TARGETED-0001 — Targeted scan earnings check must use the trade's own expiry

## Status

**Ian approved with a 10-day margin (Dean chose 10, 2026-09-25, after an independent second review and two data checks). Alan fixtures written (below). **Built 2026-09-25 (Dane role, inline): `lib/scans/checklist.ts`, `lib/scans/earningsPrecheck.ts`, new `lib/scans/__tests__/checklistStrictEarningsMargin.test.ts`. Full suite 366 files / 5416 tests pass; real `next build` passes; pushed to `main`.** Found 2026-09-25 from a Targeted AMD spread scan screenshot.

## Problem

In a Targeted spread scan, a setup that expires **before** earnings still shows a failed earnings check. Observed: AMD BPS 580/565, expiring 2026-10-23 (27d), earnings 2026-11-03 (39d). The checklist shows Earnings fail: "Within 50d — no qualifying 21-45d expiration clears it". That statement is false for this row, because its own expiry is 12 days before earnings.

The same trade in a Ranked scan (fresh scan, IVR 31.0%, DTE 21-45 chip) shows Earnings pass: "38d (2026-11-03), Outside this trade's 27d expiry". Same expiry and earnings date, opposite result, so the Targeted result is the bug. (The IVR 3.7% on the earlier Targeted screen came from stale/restored data; a fresh scan shows 31.0%. In that Ranked scan the 27d row is disqualified for a different reason, short-leg OI 137 below the 500 floor.)

On a symbol with sufficient IVR and OI, the bug would disqualify a valid trade that has no earnings exposure.

## Root cause (traced, not yet reproduced in a test)

`lib/scans/checklist.ts`, `runChecklist(..., strictOnly)`:

- Targeted BPS/BCS and IC call it with `strictOnly = true` on a one-expiry chain (`app/screener/page.tsx:7863`, `:7998`). Ranked scans call it with the default `false` (`:9812`, `:9979`). The call at `:1602` passes a variable not yet traced.
- The pre-check (`checklist.ts:38-41`) fails any stock with earnings inside `DTE_MAX + 5` days (50d), regardless of which expirations exist.
- The per-trade correction (`:86-106`, earnings after this trade's expiry gives pass) runs only `if (bestCandidate)`. Every assignment of `bestCandidate` inside `runChecklist` is gated on `!strictOnly` (`:54`, `:77`), so in strict mode it stays null and the correction never runs. The page substitutes its own candidate afterwards (`page.tsx:7866-7870`), which is too late for the earnings check.
- The strict `validExpirations` filter (`:50`) already removes expirations on or after earnings. So it already knows whether any expiration clears earnings; the pre-check does not use it.

Rank mode is unaffected: there `bestCandidate` is set and the correction runs.

## Proposed change

In strict mode only, decide the earnings result from the expirations actually being evaluated, not from the generic buffer:

| Condition (stock, earnings date parses, not past) | Result |
|---|---|
| At least one in-range expiration expires at least **10 calendar days before** earnings | pass; the reason shows the margin in days, e.g. "Earnings 12d after expiry" (final wording for Diane) |
| In-range expirations exist and none clears earnings by 10 days | fail, existing reason "no qualifying <min>-<max>d expiration clears it" (wording may mention the 10-day margin; Diane) |
| No in-range expirations at all | unchanged: the previous generic result is kept (no candidate either way; the existing "No DTE expirations" reasoning is untouched). Kept as-is on purpose so page-level reason filters that match "No 30-45 DTE" are not disturbed |
| Past date, missing date, unparseable date, ETF/index | unchanged |

Rank mode (`strictOnly = false`) is unchanged.

Inclusion stays as today: earnings **on** the expiration date counts as before expiry (`earningsOnOrBeforeExpiration`, New York basis from EARNINGS-DATEBASIS-0001). The new margin is a single constant (10 calendar days after expiry), applied to every symbol.

### Why one flat margin, and not the `estimated` flag

TastyTrade's `market-metrics` response carries `earnings.estimated`, but it cannot be trusted as "confirmed". Evidence (Dean, 2026-09-25): AMD's date is 2026-11-03 with `estimated: false` and `updated-at` 2026-09-09, while Google shows the same date as "Unconfirmed (Estimated based on historical cycles)", after market close. There is no before-open/after-close field in the response. So the margin ignores the flag. All 18 of Dean's equities showed `estimated: false`, including dates 40-54 days out that companies have not announced, so the flag carries no information. Relaxing the margin for genuinely confirmed dates is a follow-up, only after a source of real confirmation exists.

### Second source (FMP) checked and not usable on the current plan

Dean's FMP key works on `/stable/earnings-calendar`, but coverage is partial. Of 18 equities, FMP listed 11: 8 agree with TastyTrade; MSFT, META and GOOGL show 2026-10-28 in FMP against 2026-11-04 in TastyTrade (TastyTrade 7 days later, the unsafe direction). DDOG, APP, BX, TER, MU, MRVL and ORCL are absent. A one-week window (Sep 28-Oct 2) returned only NKE and CCL, and the per-company endpoint returns "symbol value not available under your current subscription" for MU. So absence from FMP never means no earnings, FMP has no time or confirmation field, and the app's `/api/event-risk` route (legacy `/api/v3` endpoints, dividend call returns 403) is degraded by the plan. FMP is not used by this ticket.

## Non-goals

- No change to which trades qualify by IVR, OI, POP, ROC or credit.
- No change to Ranked scans, CSP, covered call or PMCC earnings logic (already handled by EARNINGS-PRECHECK-0001 and SCAN-ALIGN-0001D).
- No 21-DTE management-date cutoff. Ian's suggestion to anchor the earnings cutoff to the 21-DTE management date is a separate future scan control; the default stays "earnings on or before expiry disqualifies".
- No change to the IVR floor, the "TRADE THIS" button on disqualified rows, badge weight, or header standardization (separate tickets).
- No use of `earnings.estimated` (see above).

## Tests (Alan fixtures, Quinn review)

New strict-mode cases in the checklist tests, all on the New York basis:

1. Expiry before earnings: earnings passes.
2. Boundaries (see Alan's fixtures): earnings on the expiration date fails; 1, 6 and 9 days after fail; exactly 10 days after passes and shows the margin.
3. Earnings before expiry: fails.
4. Several in-range expirations, one clears earnings: passes.
5. Several in-range, none clears: fails with the existing reason.
6. Past, missing, unparseable earnings date and ETF/index: unchanged.
7. AMD-style row (IVR below floor, expiry before earnings): earnings passes and the row is still disqualified by IVR.
8. Rank mode parity: `strictOnly = false` results identical before and after.
9. Never looser than a real risk: no case where earnings is on or before expiry passes.
10. Tightening is limited to one known band: a row passes today when earnings is 50 or more days away (the `DTE_MAX + 5` buffer), even if it falls 1-9 days after a near-45-day expiry. With a 10-day margin that band now fails (for example expiry day 45, earnings day 52). This is intended, since a date only 1-9 days past expiry is inside the observed error. Pin it with a test and pin that nothing outside this band goes from pass to fail.
11. A stale or already-past earnings date with only an estimated next date (`estimateNextEarningsDate`) does not read as a confirmed safe pass.
12. The margin applies to the chosen expiry, not just "some expiry clears".

Risky shared logic: run the full suite plus a real `next build`.

## Alan's fixtures (2026-09-25, inline lens)

Pure date arithmetic on calendar dates (`YYYY-MM-DD`, no time zones): margin = earnings date minus expiration date in whole days, on the New York basis of EARNINGS-DATEBASIS-0001. Pass requires margin >= 10. Fixed "today" 2026-09-25, stock, strict mode, DTE range 21-45.

Single expiry 2026-10-23 (28d), varying earnings date:

| Earnings | Margin (days) | Result |
|---|---|---|
| 2026-10-22 | -1 | fail (before expiry) |
| 2026-10-23 | 0 | fail (on expiry) |
| 2026-10-24 | 1 | fail |
| 2026-10-29 | 6 | fail |
| 2026-11-01 | 9 | fail |
| 2026-11-02 | 10 | pass, margin shown as 10d |
| 2026-11-03 | 11 | pass (AMD example) |
| 2026-11-20 | 28 | pass |

Calendar boundaries: expiry 2026-10-28 with earnings 2026-11-07 passes (month rollover, margin 10); expiry 2026-12-24 with earnings 2027-01-03 passes (year rollover, margin 10) and with 2027-01-02 fails (margin 9).

Several expirations: chain [2026-10-16, 2026-10-23, 2026-10-30] with earnings 2026-11-03 passes (10-16 has margin 18, 10-23 has 11; 10-30 has 4 and is excluded). Chain [2026-10-30] alone with earnings 2026-11-03 fails.

Unchanged: earnings date in the past passes; missing date passes ("None found"); unparseable date keeps today's behavior; ETF/index passes; earnings 50+ days from today with margin >= 10 passes.

Band that tightens (test 10): expiry 2026-11-09 (45d), earnings 2026-11-16 (52d, margin 7): passes today, fails after. Expiry 2026-11-09 with earnings 2026-11-20 (margin 11): passes both.

Rank mode parity: same inputs with `strictOnly = false` give identical results before and after.

## Sibling paths checked

- `lib/screener.ts:222` has a second `runChecklist` with the same generic "Within expiry window" fail. Only `/api/screen` imports it. Same class of bug; log it, do not change it in this ticket unless Paul agrees.
- The strict call at `page.tsx:1602` was traced (2026-09-25): it is `runChecklistAllExpirations`, which calls `runChecklist` once per expiry with a one-expiry chain, and its `strictOnly` comes from the rank-mode helper (default false) and the "strict" preset at `page.tsx:7418`. All strict callers pass one-expiry chains, so the fix behaves the same everywhere.
- Ranked mode passes earnings after expiry with any margin (shown in the Ranked scan above). Applying the 10-day margin there would tighten Ranked, CC and CSP, so it is out of scope here; see open question.
- CC and CSP already check earnings per expiry.

## Ian's rulings (2026-09-25, revised after independent review)

1. Earnings after the trade's own expiry passes in strict mode only with a margin of at least 10 calendar days, applied to every symbol. Dean chose 10 over 7 because TastyTrade's date was 7 days later than FMP's on MSFT, META and GOOGL (2026-09-25 comparison); the margin must exceed the observed error. A first pass allowed a 1-day margin with the number displayed; an independent review and the data check above showed that is not safe, since dates are estimates that can move earlier.
2. Earnings on the expiration date stays a fail (inclusive). Before-open or after-close timing is not in the data; AMD reports after the close, which is exactly the assignment-risk case.
3. The default cutoff stays "any earnings on or before expiry disqualifies". The 21-DTE anchored option is a separate scan-control ticket with its own fixtures. If it is ever built, it should require a confirmed date.

## Open questions

- Should the 10-day margin also apply to Ranked, CC and CSP for consistency? That tightens them versus today (they pass at any margin), so it needs its own ruling and ticket.

## Follow-up tickets to file

- `lib/screener.ts:222` duplicate `runChecklist` (same generic-window fail, used by `/api/screen` only).
- Confirmed-date handling: verify what `earnings.estimated` means across symbols before relaxing the margin.
- Red "Earnings in 39d" text shows on rows where the earnings check passes, and disagrees by a day with the checklist (38d).
- OI wording and thresholds: the same 500 is called a "floor" (red fail) and a "target" (amber warn) in different places, and the row label says "Adequate liquidity" for OI below it.
- Past earnings dates: TastyTrade still shows MRVL 2026-08-27 and ORCL 2026-09-10 (already reported). The scan passes them with only a display of an estimated next date; nothing gates a trade against that estimate.
- FMP: current plan gives partial coverage and 403 on the dividend calendar; the `/api/event-risk` route and the PMCC event-risk feature that use it are degraded. Decide: upgrade, change source, or remove.
- Two-source rule (use the earlier of TastyTrade and FMP when both have a date) only makes sense if coverage improves.

## Owner / next step

Alan fixtures, then Dean's go, then Dane build and Quinn review.
