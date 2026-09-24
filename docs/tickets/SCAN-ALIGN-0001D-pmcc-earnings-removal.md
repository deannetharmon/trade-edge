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
