# TradeEdge — Sprint Status

**Status:** Active operational source of truth
**Last Updated:** 2026-07-19 (TC-0001 implementation — Trade Command Center implemented on `feature/trade-command-center`, awaiting Product Owner review; not committed, not pushed, not merged. ES-0002 is now complete and merged into `main` at merge commit `424e068` (confirmed: `main` and `origin/main` both at `424e068`); its temporary branch has been deleted, locally and remotely. ES-0001 remains accepted, complete, and merged into `main`, and is unaffected by ES-0002 or TC-0001; see closeout report at `docs/reviews/ES-0001-Closeout-Report.md`)
**Primary Branch:** `main`
**Long-Lived Development Branch:** `feature/autopilot`

## Current State

**PT-0001 — Manual Paper Trading Sandbox** is **accepted, complete, merged, and pushed.** The original implementation (`7b41eeb`) was **rejected by the Product Owner** for blocking persistence, idempotency, identity, and accounting-safety defects (shallow idempotency hashing that silently dropped nested fields; a non-atomic lock release plus no lease-loss fencing; a three-way non-atomic ledger/audit/idempotency write; client-supplied manual-fill confirmation identity trusted as authoritative; no validation rejecting zero/negative entry credit or negative close debit). A corrective round fixed all seven required corrections and was accepted as `9a24fd9`. Several further Product Owner review rounds hardened the atomic commit design (replacing an initial `WATCH`/`MULTI`/`EXEC` approach with a single precondition-checked Redis Lua `EVAL`), ambiguous-outcome resolution, and explicit commit-outcome classification (`CONFIRMED_NOT_COMMITTED` / `OUTCOME_UNKNOWN` / `INTEGRITY_FAILURE` — only `CONFIRMED_NOT_COMMITTED` may ever produce a rejected audit event). PT-0001 was merged into `main` as `05d0f31`, and the accepted implementation report was restored/finalized in closeout commit `1ffc54a`. The temporary branch `feature/manual-paper-trading` has been **deleted, locally and remotely**, per the standard short-lived-branch lifecycle. Validation at acceptance: 182 targeted tests across 17 files, 879 tests across 66 files repo-wide, 0 failures; `tsc --noEmit` clean; `git diff --check` clean; production build subject to the documented local sandbox limitation (see Validation Baseline below). See `docs/design/PT-0001-Manual-Paper-Trading-Sandbox.md` and `docs/reviews/PT-0001-Implementation-Report.md` for the full account, including all Product Owner correction rounds.

Portfolio Intelligence implementation through **PI-0013** is complete and merged into `main`.

**PI-0014 — Marketable Pricing for Risk-Gating, Phase 1** is complete and merged into `main` (merge commit `2c79d5e`). It was implemented, recovered after an out-of-band `main` reset lost it from all reachable refs, reviewed by the Product Owner (required refactor completed), corrected through a Corrective Closeout sprint (documentation drift, missing-marketable-data test coverage, invalid-quote test coverage, unknown-liquidity classification fix, generated-artifact cleanup), accepted, and merged. The temporary branch (`feature/marketable-pricing`) was deleted locally and remotely per the standard short-lived-branch lifecycle. See `docs/reviews/PI-0014-Marketable-Pricing-Implementation-Report.md` for the full account (Process Note, Product Owner Addendum, Corrective Closeout Addendum) and validation results.

**OE-0001 — Opportunity Engine Foundation** is **complete and merged into `main`** (merge commit `c97a705`). It implements roadmap item TE-0007 / Master Spec §4.1: the canonical Opportunity Engine foundation (`lib/opportunity-engine/`), a deterministic ranking layer over already-computed Decision Engine evaluations, and one candidate adapter compatible with real `DecisionAnalysis` output (against the shape already produced by the existing `POST /api/autopilot/recommendations` route, though that route has no production caller yet). It was implemented, reviewed by the Product Owner, corrected through a corrective round (disposition-vs-disclosure separation, final display-order fix, added component test coverage, documentation corrections), accepted, and merged. The temporary branch (`feature/opportunity-engine-foundation`) was deleted locally and remotely per the standard short-lived-branch lifecycle. See `docs/design/OE-0001-Opportunity-Engine-Foundation.md` and `docs/reviews/OE-0001-Implementation-Report.md` (§10, Corrective Round Addendum) for the full account and validation results.

**Its production UI was intentionally left unmounted at merge time.** `components/opportunity-engine/BestOpportunitiesPanel.tsx` existed as a finished, tested, read-only presentational component with no page mounting it. **TC-0001 (below, awaiting Product Owner review) mounts it for the first time**, on the new `/dashboard` route, with real adapter/ranker wiring — though no real, live `DecisionAnalysis[]` feed exists anywhere in the app yet, so it still renders its own honest empty state in production today. **Manual paper simulation exists (PT-0001, below); live execution and autonomous paper trading do not exist anywhere in this codebase.**

**ES-0001 — Live Close-Order Identity and Break-Even Safety** is **ACCEPTED, COMPLETE, and MERGED into `main` at merge commit `a7f6acb`.** It investigated a real, live financial loss from a "Snap to Break Even" close-order action. Direct code investigation confirmed the leading hypothesis (position grouping too broad — `${symbol}::${expiration}` only, no strike/direction/quantity discriminator — could merge economically distinct spreads into one displayed `Position`) and found it was compounded by a broader systemic defect: at least seven independent call sites re-derived a stand-in "quantity" from an arbitrary single leg rather than a canonical value. **The first implementation round (commit `8a796ac`) was reviewed by the Product Owner and REJECTED**: grouping by quantity is not canonical position identity (two independently-opened spreads can share symbol, expiration, AND quantity), and disclosing that ambiguity in the confirmation modal is not an acceptable substitute for a hard safety block. **A first corrective round was ALSO REJECTED**: it introduced a critical 100x price-unit defect (a dollar value fed back into a field every consumer treats as broker option-price points) and did not actually enforce the broker-boundary wrapper on the production submission path. **An accepted round 2** replaced quantity-only grouping with deterministic economic-structure analysis (`lib/portfolio/closeOrderSafety.ts`: `analyzePositionStructure` proving exactly one defensible leg pairing or hard-blocking as `AMBIGUOUS_POSITION_STRUCTURE`), fixed the 100x unit defect with explicit points/dollars field naming, made every live submission call site structurally route its broker call inside `submitCloseOrderIfSafe`'s callback (`lib/portfolio/closeOrderSubmission.ts`), made quote/actual-order/displayed-P&L required (not optional) fields, added intent-aware break-even validation and actual-payload price/effect cross-checks, and added UI-level hard-blocking (disabled checkbox/button) for ambiguous positions — 65 tests across `lib/portfolio/__tests__/closeOrderSafety.test.ts` (46) and `closeOrderSubmission.test.ts` (19), reconfirmed passing against `main` today. Dean applied, committed (`90033cd`), and merged this diff into `main` (`a7f6acb`) outside the implementing session. See `docs/design/ES-0001-Live-Close-Order-Safety.md` and `docs/reviews/ES-0001-Implementation-Report.md` for the full implementation account, and `docs/reviews/ES-0001-Closeout-Report.md` for the post-merge architectural review, technical debt register, test coverage assessment, documentation audit, retrospective, and next-sprint recommendation. **The closeout review found one pre-existing, out-of-scope live-order path — `replacePendingOrder` (GTC/pending-order repricing) — that still bypasses this safety gate entirely; it is the top-ranked next-sprint candidate (ES-0002) in the closeout report.**

**ES-0002 — Pending-Order Replacement Safety** is **complete and merged into `main` at merge commit `424e068`.** It closes ES-0001 Closeout Technical Debt TD-1: `replacePendingOrder` (`app/portfolio/page.tsx`) cancelled an existing pending complex order and resubmitted (and, on failure, auto-restored) a plain order with no tick validation, no leg-identity check, no quantity check, and no display/payload cross-check — entirely outside ES-0001's safety architecture. A new module pair, `lib/portfolio/pendingOrderReplacementSafety.ts` and `lib/portfolio/pendingOrderReplacementSubmission.ts`, validates a canonical replacement/restore plan built from the broker-sourced pending order and a requested new price — deliberately NOT a `CanonicalCloseIdentity` workflow, since a pending order is an unfilled opening order with no entry-fill economics to build one from (see `docs/design/ES-0002-Pending-Order-Replacement-Safety.md` for the full rationale). Both the replacement submission and the automatic restore-on-failure submission now reach `ttPost` only through a hard-blocking, broker-mock-tested boundary (`submitPendingOrderReplacementIfSafe`/`submitPendingOrderRestoreIfSafe`) that validates the exact broker payload, and `app/portfolio/page.tsx`'s cancel/replace/restore ordering was extracted to `runPendingOrderReplacementWorkflow` so it is independently unit-testable. A pre-approval Product Owner review found two blocking defects in the actual-payload adapter/gate (a price-effect default that could mask a missing value; a `NaN`/float-tolerance price comparison that could silently pass a malformed price and could not reject an exact one-cent drift) — both fixed: missing or malformed price and price-effect values now hard-block via two new rule IDs, and payload price equality is now an exact integer-cent comparison with no tolerance, so a one-cent drift is rejected. 58 new tests (35 + 23, including the corrective-round additions); 65/65 ES-0001 tests reconfirmed passing at closeout (no regression; ES-0001 unaffected); `tsc --noEmit` clean; `git diff --check` clean. The mandatory repository-wide broker-submission inventory (`docs/reviews/ES-0002-Broker-Submission-Inventory.md`) also surfaced a second, unrelated, unguarded live-order submission path in `app/rinse-repeat/page.tsx` — documented, not fixed, per this ticket's explicit scope boundary; it requires its own Product Owner scoping decision. The temporary branch `feature/pending-order-replacement-safety` has been deleted, locally and remotely. See `docs/reviews/ES-0002-Implementation-Report.md` for the full account.

**TC-0001 — Trade Command Center** is **implemented on `feature/trade-command-center`, awaiting Product Owner review. Not committed, not pushed, not merged.** It composes existing Daily Briefing, Today's Priorities, Portfolio Health, Best Opportunity, and Background Task intelligence into a new `/dashboard` landing route. Two architecture conflicts were found against the design spec's assumptions and escalated to the Product Owner rather than resolved by assumption: (1) the shared composition logic needed a new home rather than being duplicated — resolved by extracting `app/portfolio/page.tsx`'s private composition chain into a new shared, pure `lib/portfolio-intelligence/dashboardComposition.ts` module, now consumed by both pages; (2) Next.js forbids exporting shared helpers from a `page.tsx` file — resolved by redesigning the new module's input contract so it needs no import from `page.tsx` at all; (3) `loadPositions()`'s live TastyTrade fetch/enrichment pipeline was found to be a ~4,000-6,000-line, safety-critical subsystem unsafe to relocate in this sprint — the Product Owner directed keeping it untouched in `app/portfolio/page.tsx`, extracting only the pure downstream composition, and having `/dashboard` render an honest `unavailable` state for Daily Briefing/Priorities/Health this sprint (disclosed limitation, not a bug). The Best Opportunity card mounts the previously-unmounted `BestOpportunitiesPanel` (OE-0001) for the first time, with real adapter/ranker wiring, though no real `DecisionAnalysis[]` feed exists anywhere in the app yet, so it still renders its own honest empty state. 32 new tests (7 composition-boundary + 14 view-model + 4 opportunity-wiring + 7 component); full repository regression re-run, 1,034/1,034 tests passing across 74 files; `tsc --noEmit` clean; `git diff --check` clean. See `docs/design/TC-0001-Trade-Command-Center.md` and `docs/reviews/TC-0001-Implementation-Report.md` for the full account.

**No sprint is currently accepted-and-merged beyond ES-0001/ES-0002/PT-0001.** ES-0001, ES-0002, and PT-0001 remain accepted, complete, and merged (see above). **TC-0001 is implemented and awaiting Product Owner review; not yet merged into `main`.** **PT-0002 — Application-Wide Portfolio Mode Foundation remains queued in `docs/roadmap/ROADMAP.md`, not approved, and not started** — PT-0001's acceptance satisfies its dependency, but PT-0002 itself still requires explicit Product Owner approval and scoping before any implementation begins. PI-0015 / Portfolio Intelligence corrections remain queued for live-market acceptance validation, unaffected by PT-0001, PT-0002, ES-0001, ES-0002, or TC-0001. `feature/autopilot` remains untouched by ES-0001, ES-0002, and TC-0001. No next sprint after TC-0001 is selected or approved in this document — that determination belongs to the Product Owner.

## Governance

Project workflow is governed by `planning/PROJECT_GOVERNANCE.md`.

Key operating rules:

- One active sprint at a time.
- Sprint scope freezes after approval.
- New ideas go to the backlog rather than expanding active work.
- Material document revisions are delivered as complete files, not patch instructions.
- Git operations are handled one logical step at a time and verified before proceeding.
- `main` must remain releasable.

## Current Product Rule

Autopilot must produce deterministic, explainable, portfolio-aware recommendations before it is allowed to create paper trades.

No live execution work may begin before paper execution, autonomous paper management, paper beta validation, and an explicit live-readiness review are complete. ("Paper execution" here refers to the still-dormant, **autonomous** Autopilot paper framework — Milestone C / TE-0010, not started — which is distinct from PT-0001's already-complete, **manual**, intentional-action-only paper trading sandbox. See "Completed Capability Tracker" and Milestone C below.)

For TastyTrade scans, execution remains browser-owned and client-authenticated. Do not reintroduce Vercel server-side TastyTrade scan execution until server authentication is explicitly solved.

## Repository State

Verified 2026-07-18 (ES-0001 closeout review, post-merge):

- `main` and `origin/main` both at `a7f6acb`, working tree clean
- `feature/autopilot` — the one remaining long-lived branch, untouched by PT-0001, ES-0001, or ES-0002
- `feature/live-close-safety` carried the ES-0001 work (two rejected rounds, one accepted round) and has been merged into `main`; it is a candidate for standard short-lived-branch deletion (locally and remotely), matching the lifecycle already applied to `feature/manual-paper-trading` and `feature/opportunity-engine-foundation`
- The temporary `feature/manual-paper-trading` branch has been **deleted, both locally and remotely**, per the standard short-lived-branch lifecycle

Verified 2026-07-18 (ES-0002 implementation session, start-of-session state):

- Current branch: `feature/pending-order-replacement-safety`, `HEAD` at `d2a3797` — identical to `main` (no commits beyond `main`'s tip yet; ES-0002's changes were uncommitted working-tree edits at this point)
- Working tree was clean before this session's edits began

Verified 2026-07-19 (ES-0002 closeout session): Product Owner review approved. Committed and pushed to `origin/feature/pending-order-replacement-safety`. Not merged into `main`; branch not deleted at that point.

Verified 2026-07-19 (TC-0001 pre-flight): ES-0002 merged into `main` at `424e068` (merge commit "Merge branch 'feature/pending-order-replacement-safety'"); `main` and `origin/main` both at `424e068`, confirmed via `git merge-base --is-ancestor`. `feature/pending-order-replacement-safety` deleted, locally and remotely. Branch `feature/trade-command-center` created off this clean `main` (`git merge-base feature/trade-command-center main` returns `424e068`, confirming no divergence). All TC-0001 work is uncommitted working-tree changes on this branch; nothing committed or pushed.

## Definition of Done

A sprint is complete only when all applicable items are true:

- Approved scope implemented
- Acceptance criteria satisfied
- Targeted and regression tests pass
- TypeScript validation passes
- Production build passes, or an accepted environment limitation is documented
- Safety and non-goal constraints verified
- Documentation updated
- Implementation review completed
- Changes committed and pushed
- Approved merge completed
- Temporary branches deleted locally and remotely
- Repository health verified
- This status document updated

## Completed Capability Tracker

| ID | Capability | Status | Notes |
|---|---|---:|---|
| 1A | Core Infrastructure | Complete ✅ | Redis persistence, API framework, audit/config stores, server auth helpers |
| 1B | Autopilot Framework | Complete ✅ | Confidence, opportunity score, net edge, dry-run shell, telemetry, run locking |
| TE-0001 / TE-0005A | Background Ranked Screener Stabilization | Partial 🟡 | Core cross-navigation workflow complete; cancel/reconnect regression work remains |
| Sprint 2 | Decision Engine | Complete ✅ | Ranked recommendations, complete reasoning, kill switch, deduplication, audit trail |
| PI-0001 | Portfolio Objective Engine | Complete ✅ | Canonical deterministic portfolio objectives |
| PI-0002 | Portfolio Engine Consolidation | Complete ✅ | Portfolio health and recommendation logic consolidated |
| PI-0003 | Canonical Portfolio Priority Engine | Complete ✅ | Canonical prioritization, policies, stable rule IDs |
| PI-0003.5 | Real Financial Data Wiring | Complete ✅ | Balances normalization and real financial context wiring |
| PI-0004A | Today’s Priorities UI | Complete ✅ | Pure presentation over canonical priorities |
| PI-0004B | Actionability and Wheel Awareness | Complete ✅ | Actionability dimension, strategy and assignment preference awareness |
| PI-0004C | Today’s Priorities Workflow | Complete ✅ | Dedicated subpage and persisted Complete/Reopen behavior |
| PI-0006A | Assertive Recommendations | Complete ✅ | Decisive labels and evidence bullets |
| PI-0006B | Intent-Based Recommendation Engine | Complete ✅ | Evidence-scored canonical management intents |
| PI-0007A | Recommendation Scorecard | Complete ✅ | Observable candidate scores, winner, margin, and confidence tier |
| PI-0008A | Remaining Opportunity Engine | Complete ✅ | Opportunity Captured and Remaining Opportunity metrics |
| PI-0012A | Portfolio Review Composition Layer | Complete ✅ | Composes existing health and objective engines; no new scoring or AI |
| PI-0013 | Daily Briefing Dashboard | Complete ✅ | Deterministic priorities, snapshot, opportunities, and risks summary |
| PI-0014 | Marketable Pricing for Risk-Gating, Phase 1 | Complete ✅ | Stop-loss, take-profit, emergency-exit, and Cut Losses gates now consider marketable (executable) pricing alongside mid; `PositionValuation` valuation layer; liquidity-tier classification |
| OE-0001 | Opportunity Engine Foundation | Complete ✅ | Canonical deterministic ranking layer (`lib/opportunity-engine/`) over already-computed Decision Engine evaluations; one candidate adapter compatible with real `DecisionAnalysis` output; production UI (`BestOpportunitiesPanel`) built and tested but intentionally unmounted pending a real live-candidate consumer |
| PT-0001 | Manual Paper Trading Sandbox | Complete ✅ | Manual, intentional-action-only paper-trading sandbox for CSP/BPS/BCS/IC (`lib/paper-trading/`), structurally isolated from any live-order path; single precondition-checked Redis Lua `EVAL` atomic ledger+audit+idempotency commit with explicit commit-outcome classification (`CONFIRMED_NOT_COMMITTED`/`OUTCOME_UNKNOWN`/`INTEGRITY_FAILURE`); paper-only API, `/paper-trading` page, and a Portfolio Intelligence adapter reusing the canonical Decision Engine unchanged. Distinct from, and does not touch, the still-dormant autonomous Autopilot paper framework (TE-0010) |
| ES-0001 | Live Close-Order Identity and Break-Even Safety | Complete ✅ | Deterministic economic-structure analysis (`lib/portfolio/closeOrderSafety.ts`) hard-blocks genuinely ambiguous leg pairings instead of merging-and-disclosing; fixed a critical 100x broker-price-unit defect found during corrective review; every live close/roll/stop-loss submission structurally routes through one safety gate before reaching the broker (`lib/portfolio/closeOrderSubmission.ts`); 65 tests. Closeout review (`docs/reviews/ES-0001-Closeout-Report.md`) found one pre-existing, out-of-scope live-order path (`replacePendingOrder`) still bypassing this gate — top ES-0002 candidate |
| ES-0002 | Pending-Order Replacement Safety | Complete ✅ | Closes ES-0001 Closeout TD-1: `replacePendingOrder`'s cancel/resubmit and automatic restore-on-failure now route through a dedicated plan/gate/broker-boundary module pair (`lib/portfolio/pendingOrderReplacementSafety.ts`, `lib/portfolio/pendingOrderReplacementSubmission.ts`) built on the pending order's own broker-sourced evidence, not a fabricated close identity, and validates the exact broker payload including hard-blocking missing/malformed price and price-effect values and rejecting one-cent drift via exact integer-cent comparison; 58 new tests, 65/65 ES-0001 tests unaffected. Broker inventory found one new, unrelated unguarded live path (`app/rinse-repeat/page.tsx`) — flagged, not fixed. Merged into `main` at `424e068`; temporary branch deleted, locally and remotely |
| TC-0001 | Trade Command Center | Implemented, awaiting Product Owner review 🟡 | New `/dashboard` route composing existing Daily Briefing, Today's Priorities, Portfolio Health, Best Opportunity, and Background Task intelligence; new shared, pure `lib/portfolio-intelligence/dashboardComposition.ts` consumed by both `/dashboard` and `app/portfolio/page.tsx`; mounts the previously-unmounted `BestOpportunitiesPanel` (OE-0001) for the first time, though no real `DecisionAnalysis[]` feed exists yet to populate it; Daily Briefing/Priorities/Health render a disclosed `unavailable` state on `/dashboard` this sprint since `loadPositions()`'s live acquisition pipeline was deliberately left untouched. 32 new tests; 1,034/1,034 tests passing repo-wide. Implemented on `feature/trade-command-center`; not committed, not pushed, not merged |

PI-0012A and PI-0013 were merged to `main` in commit `a90f8f1` (`merge: portfolio intelligence`). PI-0014 was merged to `main` in commit `2c79d5e` (`merge: PI-0014 marketable pricing for risk-gating`). OE-0001 was merged to `main` in commit `c97a705` (`merge: OE-0001 opportunity engine foundation`). PT-0001 was merged to `main` in commit `05d0f31` (`merge: PT-0001 manual paper trading sandbox`), with its accepted implementation report finalized in closeout commit `1ffc54a`. ES-0001 was merged to `main` in commit `a7f6acb` (`merge: ES-0001 live close-order safety`), applied and committed by Dean as `90033cd`. ES-0002 was merged to `main` in merge commit `424e068` (`Merge branch 'feature/pending-order-replacement-safety'`).

## Validation Baseline

The most recently documented Portfolio Intelligence baseline before PI-0012A/PI-0013 was:

- 398 tests passing repo-wide
- `tsc --noEmit` clean
- Production build attempts subject to the established five-minute environment limit

PI-0012A and PI-0013 were implementation-reviewed and merged. Real-position, multi-session acceptance validation of the combined Portfolio Review and Daily Briefing workflow remains pending.

**PI-0014 (merged, commit `2c79d5e`)** validation results at merge: 643 tests passing repo-wide; `tsc --noEmit` clean; local production build subject to the documented environment limitation (hangs at the initial Next.js banner in this sandbox, not treated as a regression given clean TypeScript and passing tests — Vercel remains the authoritative build check). See `docs/reviews/PI-0014-Marketable-Pricing-Implementation-Report.md` for the full account, including the Corrective Closeout Addendum.

**OE-0001 (merged, commit `c97a705`)** validation results at merge: 697 tests passing repo-wide; `tsc --noEmit` clean; local production build subject to the documented environment limitation (hangs at the initial Next.js banner in this sandbox, not treated as a regression given clean TypeScript and passing tests). Vercel validation remains unverified — no direct evidence (deployment URL, build log, or dashboard confirmation) has been supplied or confirmed. See `docs/reviews/OE-0001-Implementation-Report.md` for the full account, including the Corrective Round Addendum.

**PT-0001 (accepted, merged into `main` at commit `05d0f31`; closeout finalized at `1ffc54a`)** validation results at acceptance: 182/182 targeted tests passing across 17 files (`lib/paper-trading`, `components/paper-trading`, `app/api/paper-trading`); 879/879 tests passing repo-wide across 66 test files, run as six verified non-overlapping shards; `tsc --noEmit` clean; `git diff --check` clean; local production build subject to the same documented environment limitation (hangs at the initial Next.js banner in this sandbox — not treated as a regression given clean TypeScript and passing tests; Vercel remains the authoritative build check). The temporary branch (`feature/manual-paper-trading`) was deleted locally and remotely. See `docs/reviews/PT-0001-Implementation-Report.md` for the full account, including all Product Owner correction rounds.

**ES-0001 (accepted, merged into `main` at commit `a7f6acb`)** validation results at merge (round 2, per `docs/reviews/ES-0001-Implementation-Report.md` §0-ROUND-2.10/2.11): 65/65 targeted tests passing (`lib/portfolio/__tests__/closeOrderSafety.test.ts`, 46, and `closeOrderSubmission.test.ts`, 19); 944/944 tests passing repo-wide across 68 test files (run in 7 batches by directory, purely due to this sandbox's per-command execution-time ceiling); `tsc --noEmit` clean. Local production build subject to the same documented environment limitation as PT-0001/PI-0014/OE-0001 (hangs at the initial Next.js banner in this sandbox; not treated as a regression given clean TypeScript and passing tests — Vercel remains the authoritative build check). Note: the first (pre-corrective) round's report had separately claimed 973 tests repo-wide; round 2's freshly-captured count (944) could not be reconciled against that earlier figure from available evidence and was flagged as an open, unresolved discrepancy not attributable to ES-0001's own changes — see §0-ROUND-2.10. The ES-0001-specific 65/65 count was independently re-run against `main` today during the closeout review and still passes. See `docs/reviews/ES-0001-Implementation-Report.md` and `docs/reviews/ES-0001-Closeout-Report.md` for the full account.

**ES-0002 (complete, merged into `main` at merge commit `424e068`)** validation results at closeout: 58/58 targeted tests passing (`lib/portfolio/__tests__/pendingOrderReplacementSafety.test.ts`, 35, and `pendingOrderReplacementSubmission.test.ts`, 23 — includes 18 tests added in a pre-approval corrective round that hard-blocks missing/malformed actual-payload price and price-effect values and replaced float-tolerance price comparison with exact integer-cent comparison); 65/65 ES-0001 targeted tests reconfirmed passing, unchanged (ES-0001 unaffected); `tsc --noEmit` clean; `git diff --check` clean. The full repository suite was last measured at implementation time at 984/984 tests passing across 66 files (11 directory batches, same pre-existing per-command execution-time ceiling); that figure predates the corrective round's 18 additional tests and was not independently re-run at closeout, which validated only the two targeted suites above per the closeout procedure's scope. Local production build attempted once, subject to the same documented environment limitation as every prior ticket (hangs at the initial Next.js banner; not retried; Vercel remains the authoritative build check). The temporary branch `feature/pending-order-replacement-safety` has been deleted, locally and remotely. See `docs/reviews/ES-0002-Implementation-Report.md` for the full account.

**TC-0001 (implemented on `feature/trade-command-center`, awaiting Product Owner review; not committed, not pushed, not merged)** validation results: 32/32 new targeted tests passing (7 `lib/portfolio-intelligence/__tests__/dashboardComposition.test.ts` + 14 `lib/command-center/__tests__/buildCommandCenterViewModel.test.ts` + 4 `lib/command-center/__tests__/buildOpportunityRecommendations.test.ts` + 7 `components/command-center/__tests__/CommandCenter.test.tsx`); full repository regression re-run (not just the targeted suites), 1,034/1,034 tests passing across all 74 test files, run in 10 batches by directory due to this sandbox's same pre-existing per-command execution-time ceiling; `tsc --noEmit` clean; `git diff --check` clean. Local production build not attempted this ticket, consistent with the documented environment limitation and clean TypeScript/test results. See `docs/reviews/TC-0001-Implementation-Report.md` for the full account, including two escalated architecture conflicts and their Product-Owner-directed resolutions.

## Current Milestones

### Milestone A — Framework

**Status:** Complete ✅

Autopilot infrastructure, persistence, configuration, telemetry, run locking, and dry-run foundations are complete.

### Milestone B — Decision Engine

**Status:** Complete ✅

Autopilot can evaluate and rank candidate trades with deterministic reasoning, confidence, opportunity scoring, rejection rationale, duplicate handling, and kill-switch enforcement.

No execution capability was introduced.

### Milestone B2 — Portfolio Intelligence

**Status:** Implementation complete ✅
**Acceptance status:** Real-world workflow validation pending 🟡

TradeEdge can evaluate portfolio-wide objectives, identify current priorities, choose management intent, explain the recommendation scorecard, estimate remaining opportunity, compose a Portfolio Review, and generate a deterministic Daily Briefing.

No paper execution, live execution, order submission, or position mutation exists in this milestone.

### Milestone C — Paper Trading

**Status:** Not started ⬜

Goal: Autopilot can create simulated trades through an explicit, auditable, kill-switch-controlled paper execution engine.

This milestone is about **autonomous** Autopilot-driven paper trading (TE-0010) and remains not started. It is distinct from **PT-0001 — Manual Paper Trading Sandbox**, which is accepted and complete: PT-0001 is a manual, intentional-action-only paper ledger with no Autopilot involvement, and does not itself complete or activate this milestone. It is, however, the approved sequencing's prerequisite foundation this milestone builds on — via PT-0002 and, later, TE-0010 (see "Paper trading sequencing" under Known Follow-Ups) — not an unrelated, disconnected effort.

### Milestone D — Position Management

**Status:** Not started ⬜

Goal: Autopilot can manage paper positions across the complete lifecycle.

### Milestone E — Paper Beta

**Status:** Not started ⬜

Goal: Validate the entire paper-trading lifecycle under realistic conditions.

### Milestone F — Live Readiness Review

**Status:** Not started ⬜

Goal: Independent review confirms readiness before any live-mode implementation begins.

## Known Follow-Ups

### Paper trading sequencing

- **PT-0001 — Manual Paper Trading Sandbox: accepted, complete, merged (`05d0f31`).** Its ledger/sandbox foundation is now available for PT-0002 to build on.
- **PT-0002 — Application-Wide Portfolio Mode Foundation: queued, not approved, not started.** Builds on PT-0001's now-accepted ledger/sandbox foundation. Scope (see `docs/roadmap/ROADMAP.md`): a persistent global LIVE/PAPER selector; unmistakable mode display across every portfolio-dependent screen; a shared portfolio-context abstraction read by Portfolio Intelligence, Decision Engine inputs, the Daily Briefing, reviews, risk analysis, analytics, and the Opportunity Engine; complete live/paper data isolation with no blending or implicit copying; persistence across navigation and refresh; safe failure on missing/ambiguous context; mode displayed at every execution-like confirmation; PAPER actions able to mutate only the paper ledger; no mode switch can trigger or enable live execution; Autopilot stays disabled and out of scope.
- Sequencing is strict: PT-0001 (accepted) → PT-0002 (queued, not approved) → a separately approved paper-action integration (not yet scoped) → TE-0010 Autopilot Paper Mode, only after manual paper mode is proven.
- Do not begin PT-0002 implementation before it is explicitly approved and scoped by the Product Owner. PT-0001's acceptance satisfies PT-0002's dependency but does not itself approve or start PT-0002.

### Portfolio Intelligence acceptance

- Use Portfolio Review and Daily Briefing with real positions across several trading sessions.
- Verify that the highest-priority recommendations are correct, non-duplicative, and actionable.
- Confirm empty, healthy, concentrated, earnings-risk, profit-target, material-loss, and assignment-preferred scenarios.
- Confirm no contradictory recommendation appears across Portfolio Review, Daily Briefing, Today’s Priorities, and Position Intelligence.

### Financial data

- Verify the live TastyTrade balances payload includes `maintenance-requirement` before fully trusting the maintenance-utilization branch.
- Consolidate duplicated balances parsing still present outside the canonical normalization adapter.
- Income and drawdown-history sources do not yet exist.

### Portfolio presentation

- Priority cards do not yet deep-link to their corresponding position cards.
- Visual and screenshot validation remains incomplete for some Portfolio Intelligence surfaces.
- Older unused priority/recommendation shims should be removed only after confirming no active consumer remains.

### Decision Engine

- No dedicated IC-specific concern/evidence logic beyond the shared strategy path.
- No audit-trail viewer UI.
- Autopilot status does not yet expose a distinct `killSwitchActive` field separate from configuration state.

### Ranked screener

- Cancel Scan
- Refresh/reconnect behavior
- Regression testing

## Next Sprint Decision Gate

**PT-0001 and ES-0002 are accepted, complete, and merged.** Neither is a blocker to selecting a next sprint. **TC-0001's corrective round is complete on `feature/trade-command-center` and awaiting Product Owner review** (see above and `docs/reviews/TC-0001-Implementation-Report.md` §11) — it is complete on the feature branch but not committed, pushed, or merged, and the sprint after TC-0001 remains unselected; this document does not select one.

The corrective round resolved the prior round's rejection: `/dashboard` and `/portfolio` now share one canonical, live portfolio composition via a new `PortfolioDataProvider` (see the Implementation Report §11 for the full architecture and the 60-symbol relocation audit table), so Daily Briefing, Today's Priorities, and Portfolio Health render real, live data. `loadPositions()`'s live TastyTrade acquisition pipeline was not duplicated or left disconnected — the closed, non-React-coupled portion it depends on (60 symbols, ~1,621 lines) was relocated verbatim into `lib/tastytrade/` and `lib/portfolio-data/`; order submission and every ES-0001/ES-0002 safety-gated call site remain untouched in `app/portfolio/page.tsx`.

Once TC-0001 is reviewed, the Product Owner must determine whether the highest-value next sprint is:

1. A follow-on to address the second unguarded live-order path discovered during ES-0002's mandatory broker inventory (`app/rinse-repeat/page.tsx`'s OTOCO entry submission — see `docs/reviews/ES-0002-Broker-Submission-Inventory.md`, item 11) — candidate ES-0003;
2. Establishing a real, live `DecisionAnalysis[]` acquisition mechanism so the Best Opportunity card (now wired by TC-0001) has a real feed to rank instead of always rendering its empty state — the one remaining disclosed gap after TC-0001's corrective round;
3. PI-0015 / Portfolio Intelligence stabilization and live-market acceptance fixes (queued);
4. Automatic mark-to-market quote wiring for the PT-0001 Paper Portfolio (deferred, see its design doc §12);
5. Paper Execution preparation for the real (non-paper) Autopilot framework;
6. another roadmap capability with greater immediate trader value.

The recommendation must include rationale, explicit scope, non-goals, acceptance criteria, test requirements, and branch strategy. The sprint becomes frozen only after repository-owner approval.

## Historical Records

Detailed implementation history remains in:

- `planning/SPRINT3_PORTFOLIO_INTELLIGENCE_PLAN.md`
- `planning/SPRINT3_PI0002_PLAN.md`
- `planning/SPRINT3_PI0003_PLAN.md`
- `planning/SPRINT3_PI0003_5_PLAN.md`
- `planning/SPRINT4_PI0004A_PLAN.md`
- `planning/PI-0006B_INTENT_BASED_RECOMMENDATION_ENGINE.md`
- `planning/PI-0007A_RECOMMENDATION_SCORECARD.md`
- `docs/reviews/`
- `docs/testing/TEST-PLAN-Portfolio-Workflow.md`

Those documents provide the detailed sprint evidence; this file remains the concise operational source of truth.