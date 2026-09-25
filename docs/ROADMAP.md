# TradeEdge Roadmap (maintained by Paul — update after every major decision)

Last updated: 2026-09-24 (end of day, after `f2806c0`)

## Done this session (2026-09-24; all merged to main, production deploys green)

SCAN-ALIGN-0001 slices A `PMCC-HELD-BREAKEVEN-0001` and 0001B-1 held-card outcomes (`c26c1b1`), B `PMCC-EARNINGS-PAST-0001` (`5ee2cfc`), C1 OI policy and C2 hybrid bid/ask with the $0.50 short-call ceiling (`a44b47c`), D earnings removal and after-expiry warning (`610bdd9`), E debit below width always on (`d0978b2`), F1 delta chips (`133c842`), F2 PMCC short delta hard filter, LEAPS-ADVISOR-0001B waived (`a34098d`); PMCC-RECEIPT-0001 part 2 (delta window on the status line, `bd49f63`) and part 1 (Active PMCC rules line, `116f47e`); SCAN-GUIDE-0001 part 3 (PMCC width help lines, `116f47e`). Permanent rule: a held LEAP with quantity != 1 fails closed (multi-lot broker averaging unverifiable; Dean holds single-contract LEAPs). All of SCAN-ALIGN-0001 is complete; the PMCC registry migration's prerequisites (A through F) are met.

## Now (in build)

- EARNINGS-PRECHECK-0001 (CC and CSP earnings pre-check becomes advisory and per-expiry; Dean's false earnings warning): implemented locally; focused CC/CSP/date tests and type check pass. Local `next build` is blocked only because this environment cannot resolve Google Fonts; Vercel production build remains the release gate. Full-suite completion and Quinn review of the CSP classification path remain required before acceptance.
- Otherwise nothing building. Last merged: CSP test made date-independent (`f2806c0`; Date frozen in `CspCandidateDiscovery.test.tsx`; still fails under `TZ=Pacific/Auckland` from a fixture that mixes local `setDate` with UTC `toISOString`, not the UTC-midnight bug; three other tests hardcode a day count next to fixed dates and are only a risk if the code recomputes days from the clock, unchecked).

## Next (recommended order; scoped or ready to scope)

1. **CC and CSP earnings pre-check** (likely Dean's false earnings warning): `page.tsx` ~:1468 (CC) and ~:1280 (CSP) compare local-time `daysUntil` against the scan DTE range, not the contract's own expiry, and the fail stays visible when no candidate exists. Changes CC/CSP behavior, so Ian rules first; small ticket (Paul drafts). Bundle with the other local-time or UTC earnings comparisons: `pmccReadiness.ts:29`, `pmccScore.ts:83`, `pmccStopGtcPrompt.ts:27`, `page.tsx:3880/:8190`, `portfolio/page.tsx:2341`, `checklist.ts`, `covered-call-finder.ts:212`, `screener.ts`, `rinse-repeat/page.tsx:1395`, `csp-finder.ts:161`; the New York date helper `lib/scans/pmccEarningsDates.ts` (from B) is the model.
2. **`page.tsx:5685` held pair lookup** does not apply the breakeven floor (correctness gap in slice A's area): small ticket to Frank/Paul.
3. **SCAN-GUIDE-0001 parts 1-2** (after-scan "Width rule removed N of M short calls (ceiling: X, percent rule: Y)" line and a muted pointer when the rule removed most of a symbol's candidates; the "K more would qualify at $0.75" clause was removed by Ian). Paul holds them until the pointer's own weight check on a rendered mock. Needs CC rejection tagging at the width gate (engine data).
4. **PMCC-HELD-BREAKEVEN-0001C** (P2): held-LEAP results tiles (Avg open, Since open with em dashes), results container, "Show full breakdown", filter funnel with engine funnel data, the "Adjust short delta" banner, rejected-pairs list. Needs its own rendered mock (Dean cannot review ASCII) and Dane's UI check first (Mock 3 assumed a surface that does not exist).
5. **EARNINGS-NO-DATE-0001** (draft; missing-earnings-date caution; sequenced after D, which is done): needs Paul's scope and Diane's tag copy.
6. **PMCC registry migration** (SCREENER-CONFIG-0001 phase after CC): prerequisites met. It absorbs the PMCC scan receipt component, the dropped "always on" debit row and the F1 receipt row.
7. Small follow-ups: held card nested-button accessibility (Refresh Portfolio sits inside the card's expand button; split the header toggle), `pmccHeldReadinessClient` labels every blocked held pair `quote-quality`, `pmccScore.legLiquidityFraction` review (C1 fixed the held-long null-OI case), inline error text for invalid PMCC delta (Run is silently disabled).

## Later (on the horizon, not yet scoped)

- PMCC-HELD-LONG-FLAGGED-0001: draft, not approved. Held LEAPs that go OTM are dropped silently (`LONG_NOT_ITM`); needs a rendered flagged-state mock. Approve after 0001C's surface exists.
- Paper trading parity, six phases: (1) stock + CC, (2) PMCC, (3) LEAP-only, (4) rolls, (5) GTC/stop simulation via Vercel Cron, (6) assignment/expiration. Plan lives in `docs/paper-trading-full-parity-plan.md`. No phase ticketed or scoped yet.
- PMCC three-stage discovery flow: partially implemented. `isPairedPmccLong` in `lib/portfolio-data/pmccPairDetection.ts` is reusable. Blocks AI-POLICY-0001E.
- Task manager / background scan track (TE-0001 through TE-0005D, RF-0001): tickets read "Ready for Implementation" but reference `feature/autopilot-paper-mode`, which no longer exists. Status unverified; reconcile against main before scoping.
- LCC-0001A through E (equity-aware LEAPS/CC/PMCC lifecycle): the epic is "Approved for technical specification" and B through E read "Ready after" their predecessor. A is merged; B-E build status unverified.
- AI-POLICY-0001 (B, C, D, E, F): drafts. C is blocked on Diane's mocks, E on the PMCC three-stage flow landing, and F blocks enabling any route in Production.

## Process notes (learned 2026-09-24)

- Diane's mocks for Dean must be rendered (HTML artifact or screenshot); Dean cannot review ASCII. Where he delegates to Ian, record it in the mock doc.
- Before merging code to main run a real `next build` (es5 target rejects `for...of` over Maps; tsconfig.check.json and vitest do not catch it) and confirm Vercel's production status on the exact commit afterward. Merge from a scratch worktree so uncommitted local work is untouched. No full suite after a merge when the branch already ran it and main did not move.
- Agents read files from origin/main (`git show origin/main:<path>`) because the local checkout is stale while Dean has uncommitted work in `page.tsx`.

## Parked / deferred (with why, and what would unstick it)

- SCAN-ALIGN-0001F2: DONE (moved out of Parked; merged `a34098d`).
- LEAPS-ADVISOR-0001B: scoped, not built; no ticket file in docs/tickets/. Unstick: team go-ahead, or a re-scope decision. Gates F2.
- PMCC-ASSIGNMENT-RISK-0001: draft. Short-to-LEAP expiry-gap investigation goes now. Ex-dividend part is deferred. Unstick: Dean's ex-dividend data-source decision.
- After-hours CC "not ready" chip: rides with C as a display state only, held. Unstick: Ian's confirmation (his open item 2, management rules and "not ready").
- Autopilot extension to PMCC/CC: undecided product question, Dean's open decision. Current scope is BPS/BCS/IC/CSP only. Do not propose implementation.
- SCREENER-VISUAL-0001: draft, deferred by Dean 2026-09-23. Unstick: pick up alongside the CC, PMCC and LEAPS phases of SCREENER-CONFIG-0001.
- ENTRY-0002: deferred. Unstick: a reviewable complete-snapshot cohort of closed credit spreads.
- AI-POLICY-0001G: deferred, do not start. Unstick: Paul defines the reports (D10).
- STOCKS-ORDERS-0001: proposed, not built, touches the order path. Unstick: Diane mocks the actions column and dialog, then Alan and Ian review.
- PERFORMANCE-STRATEGY-0002: draft, not approved. Unstick: approval.
- TRADELOG-0002: proposed. Unstick: approval.
- ENTRY-0001 release enablement: implemented, awaits Quinn's live filled-OTO verification.
- Out of scope for SCAN-ALIGN-0001: roll/exit recommendations, ex-dividend on covered calls, missing earnings date as a hard exclusion, `pmccStartPrice` changes beyond the label and held-mode input.

## Dead (do not re-propose, with why)

- FUNDAMENTALS-0002: reverted at 762da02. Finviz pre-screen replaces it. Any future fundamentals gate needs a new data-source decision first.
- `feature/autopilot-paper-mode` branch: no longer exists. Autopilot code is already on main.
- Filter scan mode: standing decision. Rank and Targeted only (SCREENER-CONFIG-0001-filter-mode-decision, decided and implemented 2026-09-21).

Done (do not re-propose): screener results, CSP workflow, PM-0001/0002 position metrics, screener job progress, LCC-0001A, TT token expiry fix, recommendation/actions split, stop-dialog labeling, net-edge DTE dampen. Also implemented per ticket Status: SCREENER-CONFIG-0001A/B, SCREENER-SORT-0001, CSP-IVR-0001, CI-0001, AI-SEC-0001, STOCKS-0001, PNL-BASIS-0001, TE-0007A, and the LEAPS-DASH/POS/SINCE/ENTRY/CYCLES/SPARK/LEDGER/MANDATE/EVENTS/AI-0002/AI-0003/PMCC-START series.

## Tickets with unverified status

Paul could not read a Status line for these, or the status ("Ready for ...") cannot be reconciled with main. Reconcile before relying on them.

- No Status line found: SCREENER-OI-0001, SCREENER-UX-0001, SCREENER-PREFS-0001, SCREENER-LIQUIDITY-0001, SCREENER-CONFIG-0001 (unified scan configuration), CSP-0002, CSP-WORKFLOW-0001 (reads "Partially implemented", remainder unclear), CSP-ORDERS-0001 (approved 2026-09-22, build status unknown), PORTFOLIO-MODE-0001, TE-0001, TE-0002, TE-0007, TE-0007C (implemented pure logic; screener wiring status truncated), SEC-0001, AI-POLICY-0001 (deterministic-first AI analysis), AI-POLICY-0001A (approved to start; build state unknown), ENTRY-0001A, PERFORMANCE-STRATEGY-0001, PMCC-0001 (both files), PMCC-0002, LEAPS-INCOME-READINESS-0001, LEAPS-PI-0001 (plan only), LCC-0001 execution-sequence and review-index.
- "Ready for implementation" or "Ready for validation", build state unverified: CSP-0003, IVX-0001, POSITIONS-0002, POSITIONS-0003, POSITIONS-0004, POSITIONS-0005, LCC-0001B/C/D/E, TE-0003, TE-0004, TE-0005A/B/C/D, TE-0006A/B, RF-0001.
