# EARNINGS-DATEBASIS-0001 — Earnings and expiry day math on the New York basis at every site

## Status

**P1. Ian's ruling 2026-09-24. Approved to build (Paul scope; Dean: fix these). Not built.** Slots after the small-ready bundle. Full suite and real `next build` required (touches `page.tsx` files). Quinn reviews (qualification logic). Alan signs off on fixtures before build.

## Problem

Shared `daysUntil` in `lib/scans/scan-utils.ts` is `Math.round((new Date('YYYY-MM-DD') - now)/864e5)`: UTC midnight minus the current instant. On earnings day after ~12:00 UTC it returns -1. The checklist labels "Already reported" and skips the fail/warn, so a qualified trade can sit through an earnings-day print with a green earnings check. The expiry filter `ed >= 0 && ed <= dte` (`lib/scans/checklist.ts` :30/:45/:82) has the same bug. Rinse-repeat uses `T12:00:00Z` and flips to past after ~18:00 UTC (fail gate ~:1377).

## Scope

- One shared helper in `lib/scans/earningsPrecheck.ts`: `daysUntilNy(dateStr, asOf = currentNewYorkDate())`. Integer calendar-day math on ISO strings, no rounding, no local `Date`. Reuses `earningsOnOrBeforeExpiration`. Replaces the duplicated `T00:00:00` / `setHours` blocks. A bad date returns null and behaves as today at each site.
- FIX sites: `lib/scans/checklist.ts` :30/:45/:82 via `scan-utils` `daysUntil` (grep all callers first: it is also used for expiration DTE, so any DTE change must be deliberate); `lib/screener.ts` :250/:266 (legacy: if dead, DELETE rather than patch); `app/rinse-repeat/page.tsx` :292/~1377/1395; `lib/scans/pmccScore.ts` :76-83; `lib/portfolio/pmccStopGtcPrompt.ts` :20-28; `lib/scans/pmccReadiness.ts` :29; `lib/scans/pmccLifecycle.ts` :21/:30 (plus a strict date parser instead of the regex-only `isDate`); `app/portfolio/page.tsx` :2333-2341; `app/screener/page.tsx` :3876-3881 (`earningsWithinExpiry`) and :8192-8200 (`pmccEarningsBlocksBestFit`).
- Same-class sites: audit and fix if trivial, otherwise split out: `lib/portfolio-data/acquisition.ts` :2039, `lib/portfolio-intelligence/*` `daysUntil(earningsDate, now)` (unaudited).

## Non-goals

`csp-finder.ts` and `covered-call-finder.ts` earnings (already on the shared helper; the local `daysUntil` at `covered-call-finder.ts:36` is DTE math, a separate follow-up); `lib/autopilot/decision/recommendationEngine.ts` :147 (order path: its OWN separately reviewed ticket and commit); any threshold or scoring weight change.

## Acceptance criteria

Only the date basis changes; the one intended behavior change is the checklist earnings status on an earnings-day case (before/after golden diff). On the earnings date at 17:00 ET and 23:30 ET the checklist earnings check fails or warns and does not show "Already reported". Identical under `TZ=UTC` and `TZ=America/Los_Angeles`. The expiry filter is inclusive on the expiration date, in NY calendar days.

## Implementation notes

Fake the clock at 09:00 ET, 17:00 ET, 23:30 ET on the earnings date and 23:30 ET the day before; cases: earnings equal to the expiration, the day after the expiration, a past date, a DST boundary date. Alan: date fixtures (reuse slice D's) for the checklist (strict expiry filter and earnings status), `pmccScore`, `pmccReadiness`, `pmccLifecycle`, and screener/rinse-repeat if live; display/warning-only sites assert against the shared helper's fixtures. Suggested commits: (1) helper plus tests; (2) checklist and `scan-utils`; (3) PMCC sites; (4) portfolio, rinse-repeat and screener page sites.

## Validation steps

`tsconfig.check.json` tsc; targeted tests under both TZ values; real `next build`; full suite; deploy check.

## Risks

Shared `daysUntil` also feeds expiration DTE (a silent DTE shift changes qualification: grep every caller, keep DTE behavior unchanged unless a caller is explicitly moved and covered by a test). Checklist earnings status is qualification logic (Ian and Quinn gate it). Page-file edits: follow the `page.tsx` working-file rule.

## Rollout notes

Each commit ships revertable on its own.

## Alan's fixtures and corrections (2026-09-24); Ian's precedents

**Corrections folded in (Alan C1-C3):**
- **C1 (must fix): do NOT change `scan-utils.daysUntil` in place.** Callers use it for both earnings and expiration DTE (earnings: `checklist.ts` :30/:45/:82, `screener/page.tsx` :1683, :5961-62, :6406-37, :11844-46; expiration DTE: `checklist.ts` :45 window filter, `screener/page.tsx` :1596, :5731-32, :7807-7941, :10479, `pmccChainClient.ts:31`, `cc-tracker/page.tsx:84`, `wheel-simulator/page.tsx:467`). Add `daysUntilNy` and migrate earnings callers only; DTE window membership stays on the old basis (own ticket). Mixing bases breaks the inclusive expiry filter (at 17:00 ET with E = expiry N days out, old dte = N-1 but NY ed = N, so `ed <= dte` is false and the expiry is kept): do the inclusion tests (`checklist.ts` :45 and :85) with `earningsOnOrBeforeExpiration(E, exp)` (ISO compare), or compute both sides on `daysUntilNy`. Fixture: E = expiry at 17:00 ET must exclude the expiry.
- **C2:** add the `screener/page.tsx` earnings-sign sites above (:1683, :5961-62, :6406-37, :11844-46) to commit 4 (same "past on earnings day" bug).
- **C3:** in `pmccLifecycle.ts` the ex-dividend and short-expiry alerts (`dte` at :21-22) use the same `today` and move to the NY basis in the same commit.

**Ian's precedents (2026-09-24):** missing or zoneless `asOf` (T unknown) fails toward at-risk/exclusion (as slice D); earnings on the scan day (0 days) counts as at-risk even if reported pre-market; a timestamp-suffixed earnings date uses its leading date; expiry-window membership stays on the old basis. Short-expiry alert semantics (critical vs warning during 8pm-midnight ET on X-1): Ian ruling pending in this thread.

**`daysUntilNy(dateStr, asOf = currentNewYorkDate())`:** `e = normalizeEarningsDate(dateStr)`; `t = newYorkDateFromAsOf(asOf)` (date-only passes through; a datetime needs Z or an offset); null if either is null; else `calendarDaysBetween(t, e)` (export it from `earningsPrecheck.ts`; `Date.UTC` integer math, no rounding, never local getters); zoneless asOf datetime returns null. Fixtures (identical under `TZ=UTC` and `America/Los_Angeles`; E = 2026-09-24, EDT = UTC-4): asOf 09-24T13:00Z -> 0; 09-24T21:00Z -> 0; 09-25T03:30Z -> 0; 09-25T04:00Z -> -1; 09-24T03:59Z -> +1; NY date strings '2026-09-24' -> 0, '2026-09-25' -> -1. Winter E = 2026-12-15 (EST): 14:00Z, 22:00Z, 12-16T04:30Z -> 0; 12-16T05:00Z -> -1. Spring DST (07:00Z on 03-08), E = 2026-03-08: 03-08T06:59Z and 07:00Z -> 0; 03-09T03:59Z -> 0; 03-09T04:00Z -> -1. Fall DST (06:00Z on 11-01), E = 2026-11-01: 11-01T03:59Z -> +1; 11-01T04:00Z -> 0; 11-02T04:59Z -> 0; 11-02T05:00Z -> -1. Multi-day: E 2026-10-16, asOf 09-24T21:00Z -> 22; E 2026-11-01, asOf 2026-10-31 -> 1. Null: '2026-02-30', '2026-13-45', '', 'N/A', null, undefined, 20261001, zoneless asOf datetime. E = '2026-09-24T16:00:00Z' -> 0. (Old `Math.round` daysUntil returns -1 for the earnings date from 12:00Z, i.e. from 08:00 EDT, so the old bug starts at 9am ET, not only late day.)

**Checklist fixtures (B = DTE_MAX+5, ed = daysUntilNy(E)):** ed = -1 pass "Already reported"; ed = 0 at 09:00, 17:00 and 23:30 ET fails in strictOnly ("Earnings in 0d"), warns in rank mode; ed = B-1 fail/warn; ed = B pass "Outside". Post-candidate (dte = bestCandidate.dte): ed = dte fail/warn; ed = dte+1 pass; ed = -1 "Already reported". Strict expiry filter (inclusive, NY days): E = expiry excluded; E = expiry+1 kept; E = expiry-1 excluded; E past kept; DST day 2026-11-01 NY-day counts; all at 09:00, 17:00, 23:30 ET on the earnings date plus 23:30 ET the day before (ed = 1). **Golden diff** (E = 2026-09-24, asOf 21:00Z, strictOnly): old d = -1, status pass, "2026-09-24 (past)", "Already reported", expiries not filtered; new d = 0, initial check fails "Earnings in 0d (2026-09-24)" (rank mode: warn), post-candidate fails "Earnings in 0d — before this trade's expiry", every expiry with dte >= 0 filtered, ticker not qualified.

**PMCC fixtures (T = 2026-09-24, X = 2026-10-16; each at 09:00, 17:00, 23:30 ET; both TZ):** `pmccScore` :76 (clock must be injectable): E = T true; T-1 false; X true; X+1 false; E = 2026-10-01T16:00:00Z old: invalid Date returns false, new: true (leading date; behavior change per Ian's precedent); '2026-02-30' false. `pmccReadiness` :29: E = T at 23:30 ET gate 'fail' (or 'pass, caution acknowledged' when policy.earnings is not 'block'; old: 'pass, no event'); E = T-1 pass; E = X fail; E = X+1 pass. `pmccLifecycle` :21/:30: now 2026-09-24T23:59:59Z (19:59:59 ET), E = 09-24: critical ACTION_REQUIRED (old and new agree); now 2026-09-25T00:00:00Z (20:00 ET): new fires, old drops; 09-25T03:59Z fires, 04:00Z does not; ex-dividend same rule; EST rollover now 2026-12-16T00:00Z, X and E = 12-15; short expiry X = 2026-09-25 at now 09-25T00:00Z: old dte 0 (critical) vs new dte 1 (warning): semantic change pending Ian; zoneless now or X = '2026-02-30': DATA_UNAVAILABLE; grep the lifecycle tests for a date-only `now` before build; existing tests that pin dte via UTC-day math flip only inside the 20:00-24:00 ET window.
