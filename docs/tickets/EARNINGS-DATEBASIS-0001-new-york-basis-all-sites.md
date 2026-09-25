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
