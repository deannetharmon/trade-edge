# TradeEdge Roadmap (maintained by Paul — update after every major decision)

Last updated: 2026-09-24

## Now (in build or next up)

Build order for SCAN-ALIGN-0001 (accepted by Dean 2026-09-24). Each engine flip gets its own revertable test flip; do not bundle engine flips.

1. PMCC-HELD-BREAKEVEN-0001 (A, P1, PR1): held-LEAP short calls get a breakeven floor. Fixtures, quantity guard and build plan signed off by Alan, Ian and Quinn (2026-09-24); build not started. Merge only once Dane has a committed start on PMCC-HELD-BREAKEVEN-0001B (Dean, 2026-09-24; interim silent fail-closed states on production acknowledged).
   - Permanent rule: a held LEAP with quantity > 1 fails closed (`COST_BASIS_UNAVAILABLE`), because multi-lot broker averaging is unverifiable. Dean holds single-contract LEAPs.
   - PMCC-HELD-BREAKEVEN-0001B-1 (captions, banner, discovery-time pre-modal block, rejected styling on the existing held card): re-scoped 2026-09-24 after Dane found Mock 3b's surface does not exist; build to Mock 3c (`SCAN-ALIGN-0001-mock-3c.md`), pending Ian's copy check. Unit-suspect renders in results (needs spot). Own PR; blocks PR1 merge.
2. PMCC-EARNINGS-PAST-0001 (B, P2, PR2): PMCC earnings warning fires on past dates. Approved by Dean; fixtures signed off by Alan and Ian; may travel with A as two commits. Must land before D.

## Next (scoped, approved, not started)

Slots 3-8 of the SCAN-ALIGN-0001 order. All accepted by Dean 2026-09-24, none built.

- SCAN-ALIGN-0001C1 (slot 3, PR3 commit 1): OI policy. Follows A and B. Touches `page.tsx:1494`, so full suite and Vercel preview are required.
- SCAN-ALIGN-0001C2 (slot 4, PR3 commit 2): hybrid bid/ask with a $0.50 ceiling, scoped to short calls. Follows C1. Needs Diane's mock 2 approved and Alan's integer-cents pass.
- SCAN-ALIGN-0001D (slot 5, own PR): PMCC earnings removal plus after-expiry warning (Ian's amendment). After B. Needs Alan's date fixtures and Diane's tag copy.
- SCAN-ALIGN-0001E (slots 6-7, own PR, two commits): debit below width becomes non-switchable (E1 stop reading the field, E2 hard reject). After A. Separate PR from D. Alan and Ian sign off.
- SCAN-ALIGN-0001F1 (slot 8): PMCC delta control polish (chips, hint, receipt row). Needs Diane's mock 1 approved.
- PMCC-HELD-LONG-FLAGGED-0001: draft only, not approved. Paul approves after F1 lands. Needs Diane's flagged-state mock (part of mock 3).

## Later (on the horizon, not yet scoped)

- PMCC-HELD-BREAKEVEN-0001C (P2): held-LEAP results tiles (Avg open and Since open with em dashes), results container, "Show full breakdown", filter funnel and engine funnel data, "Adjust short delta" banner, rejected-pairs list. Needs its own mock and approval; not tied to PR1.
- Follow-ups found building A and B (2026-09-24, unticketed; Paul to scope):
  - Earnings-date comparisons elsewhere still use raw strings, UTC or host-local dates: `pmccReadiness.ts:29`, `pmccScore.ts:76`, `pmccLifecycle.ts:14,30` (regex-only `isDate`), `covered-call-finder.ts:185`, `lib/screener.ts:245`; `page.tsx` unchecked. Owned by slice D and EARNINGS-NO-DATE-0001.
  - `page.tsx:5685` pair lookup for a held long does not apply the breakeven floor.
  - `pmccHeldReadinessClient.ts` labels every blocked held pair `quality: quote-quality` (its `QUOTE|BID_ASK|MARKET` match hits the always-present QUOTES_READY gate); fold into 0001B or a separate ticket.
- Paper trading parity, six phases: (1) stock + CC, (2) PMCC, (3) LEAP-only, (4) rolls, (5) GTC/stop simulation via Vercel Cron, (6) assignment/expiration. Plan lives in `docs/paper-trading-full-parity-plan.md`. No phase ticketed or scoped yet.
- PMCC three-stage discovery flow: partially implemented. `isPairedPmccLong` in `lib/portfolio-data/pmccPairDetection.ts` is reusable. Blocks AI-POLICY-0001E.
- EARNINGS-NO-DATE-0001: draft (Ian, 2026-09-24). Missing-earnings-date caution. Needs Paul scope; sequenced after D.
- PMCC registry migration (SCREENER-CONFIG-0001 phase after CC): A through E, and F or a recorded delta difference, must land first.
- Task manager / background scan track (TE-0001 through TE-0005D, RF-0001): tickets read "Ready for Implementation" but reference `feature/autopilot-paper-mode`, which no longer exists. Status unverified; reconcile against main before scoping.
- LCC-0001A through E (equity-aware LEAPS/CC/PMCC lifecycle): the epic is "Approved for technical specification" and B through E read "Ready after" their predecessor. A is merged per Project state; B-E build status unverified.
- AI-POLICY-0001 (B, C, D, E, F): drafts. C is blocked on Diane's mocks, E on the PMCC three-stage flow landing, and F blocks enabling any route in Production.

## Parked / deferred (with why, and what would unstick it)

- SCAN-ALIGN-0001F2 (delta rule flip: PMCC delta becomes a hard filter): direction accepted, held. Unstick: F1 built, LEAPS-ADVISOR-0001B built or re-scoped, mock 3 approved, and Dean's timing decision. If still held at PMCC registry migration, the registry records delta as a deliberate CC-vs-PMCC difference.
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
