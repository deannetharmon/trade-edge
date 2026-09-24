# SCAN-ALIGN-0001D — PMCC earnings: remove candidates through expiry; warn after expiry

## Status

**Accepted by Dean 2026-09-24, with Ian's amendment for the after-expiry window. Not built.** Build order slot 5, after `PMCC-EARNINGS-PAST-0001` (B). Its own PR (not bundled with E). Alan's date fixtures and Diane's tag copy needed before build.

## Problem

Dean reports false-positive earnings warnings: "if my earnings date is beyond the expiration, it still warns me." `pmccDecision.ts:197` fires on `earningsDate <= shortLeg.expiration` with no lower bound, so it warns on already-reported dates (B). It does not itself fire on earnings after expiry. The covered-call pre-check at `page.tsx:1468` compares earnings against `ccRules.DTE_MAX`, not the contract's own expiry, and may show "Earnings within expiry window" for earnings after the selected contract's expiry. Which surface Dean sees is unconfirmed; Alan confirms the path before build.

## Scope (Ian's rule; E = earnings date, T = today, X = short expiry)

| Earnings date | Result |
|---|---|
| E < T (already reported) | Pass, no warning |
| T ≤ E ≤ X | **Remove from results** (like CC; not a DISQUALIFIED gate) |
| X < E ≤ X + 5 business days | **Warning only**: new code `EARNINGS_AFTER_SHORT_EXPIRY`, ambient tier tag "Earnings N bd after expiry". Never a fail; no effect on qualification or ranking |
| E > X + 5 business days | Silent |

- "Today" is the New York date derived from `asOf`; compare ISO `YYYY-MM-DD` strings. Malformed dates count as no date. Earnings on the scan day are excluded even if reported pre-market. Do not reuse `daysUntil` (local day count, off by one after 8pm ET).
- One shared pure ISO-date helper in `lib/` (not `page.tsx`) returns the zone (past, exclude, warn-after, clear) for PMCC and CC.
- The 5-business-day value is a named constant, not a scan control. Business days: weekends plus NYSE holidays if a market-calendar helper already exists in the repo (reuse it); otherwise weekends-only. No new library.
- `EARNINGS_BEFORE_SHORT_EXPIRY` (`pmccDecision.ts:197`) stays as a defensive layer, and must never fire when E < T (a one-line revert).
- CC: add the same after-expiry tag for parity (additive, no new exclusion); optional if it widens the diff. Review `page.tsx:1468` for the date-base conflict.
- Held-LEAP mode applies the same exclusion. A zero-shorts result shows the empty-result banner, not an error. The result-count receipt reflects exclusions.

## Non-goals

- Making the after-expiry window tunable (separate ticket if wanted).
- A missing earnings date as an exclusion (`EARNINGS-NO-DATE-0001`).
- Warning-only handling of earnings on or before expiry.

## Acceptance criteria (Alan)

- Keep: E = T excluded; E = X excluded; E = X + 1 calendar day passes as warn-after; E = T − 1 passes silently; `asOf 2026-10-02T01:00Z` (2026-10-01 21:00 ET) with earnings 2026-10-01 excluded; DST-end date 2026-11-01; timestamp-suffixed value; null.
- New: E = X + 1bd, X + 5bd (warn), X + 6bd (silent); a weekend crossing; a holiday crossing if holidays are supported; malformed dates ("2026-13-45", "", "N/A"); two expiries on one symbol with only the earlier removed. Helper runs under `TZ=UTC` and `TZ=America/Los_Angeles`.

## Implementation notes

- Tests: any `pmccDecision.test.ts` assertion on the `EARNINGS_BEFORE_SHORT_EXPIRY` gate flips or is deleted (grep by name). `pmccProduction.test.ts` cases passing `earningsDate` (`pmccProduction.ts:157/184/199`) may see fewer candidates. Leave the `ccConfigTruthfulness.test.ts` earnings block; it uses UTC and `new Date()`, so the CC and PMCC date bases now differ.
- Diane: tag copy, ambient tier. No modal, no banner.

## Validation steps

`tsconfig.check.json` tsc, full suite, Vercel preview if `page.tsx:1468` changes.

## Rollout notes

Independently revertable. Depends on B being merged, not on C.

## Fixtures, corrections and rulings (Alan, Ian; 2026-09-24)

**Approved by Ian (2026-09-24) with these details.** Removal is a hard exclusion applied to the PMCC short-leg candidates before or at pairing; **removal location is a filter in `buildPmccScreenResults` (`pmccProduction.ts`) or a pre-pairing filter on short legs, not a gate** (the `EARNINGS_BEFORE_SHORT_EXPIRY` gate is a warning and warnings never affect qualification; Alan: ticket named no location). The gate at `pmccDecision.ts:216-226` stays as a defensive layer that must never fire on E < T. B already fixed the PMCC past-date false warning; **Dean's false warning is most likely the CC pre-check at `page.tsx:1468-1471`** (local-time `daysUntil` against `ccRules.DTE_MAX`, stays visible with no candidate; same pattern in the CSP pre-check at `:1280`; the card advisory at `:3873` is correct but local time). Confirming the exact surface is Dane's first check; fix the CC pre-check only if it is in the CC path D touches, otherwise log it.

**Ian's rulings:** Q1 count business days in (X, E] and tag "after expiry" even when N = 0 (a Saturday just after expiry is still after expiry; never show "0 bd"). Q2 missing/unparseable `asOf`: still exclude when E <= X (fail toward exclusion; log or flag the unknown-T case). Q3 extract the existing private `isNyseHoliday` (`pmccProduction.ts:73`, 10 standard holidays, algorithmic Good Friday) to `lib/scans/nyseCalendar.ts` (avoids an import cycle with `pmccEarningsDates.ts`) and use it for the window; known limits (a Saturday Jan 1 wrongly shifts to Dec 31; no one-off closures) documented in the file header and pinned by tests, not fixed here. Weekends-only fallback, if ever needed, uses UTC arithmetic (`Date.UTC`, `getUTCDay`); never reuse `page.tsx:562 addBusinessDays` (local time). Window end is X + 5 business days (`E <= X+5bd` warns; `E >= X+6bd` silent). **Held mode (Ian):** if earnings removes every short, the LEAP has no pair and would vanish or show generic empty copy, so an on-screen reason is IN scope: carry a `removedByEarnings` outcome on the symbol (no pair failure reason), banner `Short calls not offered: earnings on {date} falls on or before every expiry in your DTE range.`, never "no short calls found" (extend the NEVER regex tests), no action button; `COST_BASIS_UNAVAILABLE` (not-checked) wins over earnings-removed; result-count receipt counts exclusions. No Diane mock needed (reuses the banner slot; Ian approved the copy).

**Fixtures** (T = 2026-09-24 Thu, asOf `2026-09-24T15:00:00Z`, X = 2026-10-16 Fri; every row runs under `TZ=UTC` and `TZ=America/Los_Angeles`, identical results):

| Case | E | Result |
|---|---|---|
| E = T-1 | 2026-09-23 | pass, silent |
| E = T | 2026-09-24 | exclude |
| E between T and X | 2026-10-01 | exclude |
| E = X | 2026-10-16 | exclude |
| X+1 calendar (Saturday) | 2026-10-17 | warn (after expiry, N = 0; Q1) |
| X+1bd | 2026-10-19 | warn, N = 1 |
| X+5bd | 2026-10-23 | warn, N = 5 |
| X+6bd | 2026-10-26 | silent |
| Weekend after window | 2026-10-24 | silent |
| Weekend crossing | X=10-16, E=10-23 | 5bd, not 3 |
| Thanksgiving (X=2026-11-20) | E=2026-11-30 | holiday-aware warn (5bd) |
| Good Friday (X=2026-04-02) | E=2026-04-10 | holiday-aware warn (04-06 is 1bd) |
| NY evening | asOf 2026-10-02T01:00Z, E=2026-10-01 | T=10-01, exclude |
| DST boundary | asOf 2026-11-02T04:59Z, E=11-01 | T=11-01, exclude |
| DST boundary | asOf 2026-11-02T05:00Z, E=11-01 | T=11-02, silent pass |
| Timestamp suffix | 2026-10-01T16:00:00Z | leading date used, exclude |
| Malformed E | "2026-13-45", "", "N/A", "2026-02-30", null, undefined, 20261001 | no date, silent |
| Missing asOf, E <= X | any | exclude (Q2) |
| Malformed X, or zoneless asOf datetime | n/a | no gate, or lower bound skipped |

Two expiries on one symbol (X1 = 10-16, X2 = 11-20, E = 10-30) — **corrected direction:** X1 (earlier, expires before E) is KEPT and silent (E is 10 business days past X1); X2 (on or after E) is REMOVED. Also cover: held mode with zero shorts left shows the `removedByEarnings` banner; receipt counts reflect exclusions; the CC parity tag only if built.

**Tests that flip:** `pmccEarningsGate.test.ts` in-window rows (B3-B5, B9/B10, B13/B14/B19, B15-B18, B20a-d, B21/B22); `pmccProduction.test.ts` "threads session.asOf into the earnings gate" (E = 08-20, T = 08-14 becomes excluded) and `pmccProduction.test.ts:49-58`; `pmccDecision.test.ts` has no gate assertions by grep. Leave `ccConfigTruthfulness.test.ts` (:142-161) and `covered-call-finder.test.ts` (:199-208) alone.
