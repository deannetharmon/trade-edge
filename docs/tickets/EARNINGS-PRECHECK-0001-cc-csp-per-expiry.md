# EARNINGS-PRECHECK-0001 — CC and CSP earnings pre-check: advisory, per-expiry

## Status

**Implemented and deployed to Production 2026-09-24; awaiting Quinn review.** CC and CSP ship as one small ticket. Focused CC/CSP/date tests and type checking pass. The local `next build` reached only the external Google Fonts fetch and could not resolve it in this environment; Vercel's clean Production build passed in 56s, so the release gate is satisfied. Quinn review of the CSP classification path remains required for ticket acceptance.

## Problem

Dean: "if my earnings date is beyond the expiration, it still warns me." The CC pre-check (`page.tsx` ~:1446-1493) and the CSP pre-check (~:1264-1287, ~:1362) use local-time `daysUntil(earnings)` and fail "Earnings within expiry window" when `d <= DTE_MAX`. DTE_MAX is the scan's maximum DTE, not the contract's expiry. Example: DTE_MAX 45, earnings in 30 days, a 21-DTE call exists: earnings do not touch that contract, but the row fails the symbol. The CC row is corrected only when a `bestCandidate` exists; otherwise the fail stays and is pushed into `failReasons` (~:1493). CSP classification may run before discovery (~:1284-1287, `findAllCsp`) using DTE_MAX; Dane verifies this first. Read `git show origin/main:app/screener/page.tsx`; the local checkout is stale.

## Scope

- **Ian ruling 2026-09-24 (wording):** the earnings pre-check alone never adds to `failReasons`. When every in-window expiry is on or after earnings, the result is a qualification outcome, "no eligible expiration", and it counts as an earnings fail (it feeds `hasEarningsBlock`, the SmartSuggestions earnings count and the post-earnings calendar button, all of which match the substring "Earnings" in `failReasons`, which is fragile). Open follow-up: a whole-page test that a card in that outcome offers the post-earnings re-screen did not pass (button not found in the rendered CC scan), so the coupling is unverified; check whether the advisory reaches `failReasons` in that scenario. Ian also asks Diane to make the row severity consistent with the fail count (amber row vs counted fail).
- The pre-check becomes **advisory** and never disqualifies. Earnings inside the window excludes later expirations; earlier ones remain.
- Only the **per-contract test** disqualifies: earnings on or before that contract's expiry.
- If every expiry in the DTE_MIN-DTE_MAX window is on or after earnings, the result is a clear qualification outcome, "no eligible expiration".
- Date basis is New York, via `newYorkDateFromAsOf` in `lib/scans/pmccEarningsDates.ts`, with ISO string comparison. N is NY calendar days. The pre-check and the per-contract check use the same basis.
- CSP is not treated more loosely than CC (a short put through earnings is a binary-event risk).
- Copy, on the existing checklist row:
  - Advisory: "Earnings in {N}d ({date}): expirations on or after {date} are excluded; earlier expirations remain."
  - None eligible: "Earnings in {N}d ({date}) fall before every expiry in the {DTE_MIN}-{DTE_MAX}d window: no eligible expiration."
  - Keep "Outside earnings window" when earnings are beyond the window.
  - CSP per-candidate: "Earnings {date} falls on or before this {dte}d expiry: assignment risk into a binary event."

## Non-goals

The other local-time earnings comparisons stay a separate follow-up ticket: `pmccScore.ts`, `pmccStopGtcPrompt.ts`, `pmccReadiness.ts`, `portfolio/page.tsx`, `checklist.ts`, `screener.ts`, `rinse-repeat/page.tsx`, `csp-finder.ts:161`. Missing-date caution is EARNINGS-NO-DATE-0001. No PMCC change (done in B and D). No new UI; no Autopilot change.

## Acceptance criteria

- Earnings inside the window but after a contract's expiry: that contract passes, with the advisory copy.
- Earnings on the expiry date: that contract fails.
- Earnings beyond the window: passes, "Outside earnings window".
- CC with no `bestCandidate` no longer fails or adds to `failReasons` from the pre-check alone.
- CSP classification uses each candidate's own expiry, never DTE_MAX.
- No local-time date math in the CC or CSP earnings paths.

## Required tests

Inside the window after the expiry (passes); on the expiry date (fails); beyond the window (passes); NY date-boundary case (an evening ET timestamp that is the next UTC day; reuse D's fixtures); all expirations excluded ("no eligible expiration"); CSP classification uses the per-candidate expiry (Quinn); CC with no `bestCandidate` has no pre-check failure.

## Gates

Ian: approved. Alan: date fixtures only, reuse D's. Diane: no mock needed (copy on an existing checklist row). Quinn: reviews the CSP classification path.

## Validation steps

`tsconfig.check.json` tsc, targeted tests, real `next build`, full suite (CSP classification is qualification logic), Vercel deploy check.

## Risk

CSP classification decides which puts are disqualified; wrong per-candidate logic silently changes qualified sets (hence the full suite and Quinn's review). `page.tsx` is large and prone to regression: follow the working-file rule and diff before delivering.
