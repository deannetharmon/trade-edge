# TradeEdge — Sprint Status

**Status:** Active operational source of truth
**Last Updated:** 2026-07-24 (MB-0001A closeout. `main` and `origin/main` are both at `8a872aa` ("merge: MB-0001A deterministic morning briefing attention feed"), working tree clean. This update also records two merges that occurred after DOC-0001 last reconciled this document (`7acb641`) and were not yet reflected here: **OE-0002B — Recommendation Service Foundation & Dashboard Integration** (merged `26bd9e2`) and **DOC-0001 itself** (merged `822e8fc` — the sprint that authored this document's prior revision was, by the time of this update, itself already complete and merged, a fact this document had not yet recorded about itself). **No implementation sprint is currently active.**)
**Primary Branch:** `main`
**Long-Lived Development Branch:** `epic/autopilot` (previously `feature/autopilot`; renamed — see Branch Policy below. Untouched by every sprint listed in this document.)

## Current State

**PT-0001 — Manual Paper Trading Sandbox** is **accepted, complete, merged, and pushed.** The original implementation (`7b41eeb`) was **rejected by the Product Owner** for blocking persistence, idempotency, identity, and accounting-safety defects (shallow idempotency hashing that silently dropped nested fields; a non-atomic lock release plus no lease-loss fencing; a three-way non-atomic ledger/audit/idempotency write; client-supplied manual-fill confirmation identity trusted as authoritative; no validation rejecting zero/negative entry credit or negative close debit). A corrective round fixed all seven required corrections and was accepted as `9a24fd9`. Several further Product Owner review rounds hardened the atomic commit design (replacing an initial `WATCH`/`MULTI`/`EXEC` approach with a single precondition-checked Redis Lua `EVAL`), ambiguous-outcome resolution, and explicit commit-outcome classification (`CONFIRMED_NOT_COMMITTED` / `OUTCOME_UNKNOWN` / `INTEGRITY_FAILURE` — only `CONFIRMED_NOT_COMMITTED` may ever produce a rejected audit event). PT-0001 was merged into `main` as `05d0f31`, and the accepted implementation report was restored/finalized in closeout commit `1ffc54a`. The temporary branch `feature/manual-paper-trading` has been **deleted, locally and remotely**, per the standard short-lived-branch lifecycle. Validation at acceptance: 182 targeted tests across 17 files, 879 tests across 66 files repo-wide, 0 failures; `tsc --noEmit` clean; `git diff --check` clean; production build subject to the documented local sandbox limitation (see Validation Baseline below). See `docs/design/PT-0001-Manual-Paper-Trading-Sandbox.md` and `docs/reviews/PT-0001-Implementation-Report.md` for the full account, including all Product Owner correction rounds.

Portfolio Intelligence implementation through **PI-0013** is complete and merged into `main`.

**PI-0014 — Marketable Pricing for Risk-Gating, Phase 1** is complete and merged into `main` (merge commit `2c79d5e`). It was implemented, recovered after an out-of-band `main` reset lost it from all reachable refs, reviewed by the Product Owner (required refactor completed), corrected through a Corrective Closeout sprint (documentation drift, missing-marketable-data test coverage, invalid-quote test coverage, unknown-liquidity classification fix, generated-artifact cleanup), accepted, and merged. The temporary branch (`feature/marketable-pricing`) was deleted locally and remotely per the standard short-lived-branch lifecycle. See `docs/reviews/PI-0014-Marketable-Pricing-Implementation-Report.md` for the full account (Process Note, Product Owner Addendum, Corrective Closeout Addendum) and validation results.

**OE-0001 — Opportunity Engine Foundation** is **complete and merged into `main`** (merge commit `c97a705`). It implements roadmap item TE-0007 / Master Spec §4.1: the canonical Opportunity Engine foundation (`lib/opportunity-engine/`), a deterministic ranking layer over already-computed Decision Engine evaluations, and one candidate adapter compatible with real `DecisionAnalysis` output. It was implemented, reviewed by the Product Owner, corrected through a corrective round (disposition-vs-disclosure separation, final display-order fix, added component test coverage, documentation corrections), accepted, and merged. The temporary branch (`feature/opportunity-engine-foundation`) was deleted locally and remotely per the standard short-lived-branch lifecycle. Its production UI (`components/opportunity-engine/BestOpportunitiesPanel.tsx`) was intentionally left unmounted at merge time — a finished, tested, read-only presentational component with no page mounting it, per Product Owner direction not to mount an empty surface with nothing behind it. **This gap is now closed: OE-0002A (below) activates it for the first time.** See `docs/design/OE-0001-Opportunity-Engine-Foundation.md` and `docs/reviews/OE-0001-Implementation-Report.md` (§10, Corrective Round Addendum) for the full account and validation results.

**ES-0001 — Live Close-Order Identity and Break-Even Safety** is **ACCEPTED, COMPLETE, and MERGED into `main` at merge commit `a7f6acb`.** It investigated a real, live financial loss from a "Snap to Break Even" close-order action. Direct code investigation confirmed the leading hypothesis (position grouping too broad — `${symbol}::${expiration}` only, no strike/direction/quantity discriminator — could merge economically distinct spreads into one displayed `Position`) and found it was compounded by a broader systemic defect: at least seven independent call sites re-derived a stand-in "quantity" from an arbitrary single leg rather than a canonical value. **The first implementation round (commit `8a796ac`) was reviewed by the Product Owner and REJECTED**: grouping by quantity is not canonical position identity (two independently-opened spreads can share symbol, expiration, AND quantity), and disclosing that ambiguity in the confirmation modal is not an acceptable substitute for a hard safety block. **A first corrective round was ALSO REJECTED**: it introduced a critical 100x price-unit defect (a dollar value fed back into a field every consumer treats as broker option-price points) and did not actually enforce the broker-boundary wrapper on the production submission path. **An accepted round 2** replaced quantity-only grouping with deterministic economic-structure analysis (`lib/portfolio/closeOrderSafety.ts`: `analyzePositionStructure` proving exactly one defensible leg pairing or hard-blocking as `AMBIGUOUS_POSITION_STRUCTURE`), fixed the 100x unit defect with explicit points/dollars field naming, made every live submission call site structurally route its broker call inside `submitCloseOrderIfSafe`'s callback (`lib/portfolio/closeOrderSubmission.ts`), made quote/actual-order/displayed-P&L required (not optional) fields, added intent-aware break-even validation and actual-payload price/effect cross-checks, and added UI-level hard-blocking (disabled checkbox/button) for ambiguous positions — 65 tests across `lib/portfolio/__tests__/closeOrderSafety.test.ts` (46) and `closeOrderSubmission.test.ts` (19). See `docs/design/ES-0001-Live-Close-Order-Safety.md` and `docs/reviews/ES-0001-Implementation-Report.md` for the full implementation account, and `docs/reviews/ES-0001-Closeout-Report.md` for the post-merge architectural review, technical debt register, test coverage assessment, documentation audit, retrospective, and next-sprint recommendation.

**ES-0002 — Pending-Order Replacement Safety** is **complete and merged into `main` at merge commit `424e068`.** It closes ES-0001 Closeout Technical Debt TD-1: `replacePendingOrder` (`app/portfolio/page.tsx`) cancelled an existing pending complex order and resubmitted (and, on failure, auto-restored) a plain order with no tick validation, no leg-identity check, no quantity check, and no display/payload cross-check — entirely outside ES-0001's safety architecture. A new module pair, `lib/portfolio/pendingOrderReplacementSafety.ts` and `lib/portfolio/pendingOrderReplacementSubmission.ts`, validates a canonical replacement/restore plan built from the broker-sourced pending order and a requested new price. 58 new tests; 65/65 ES-0001 tests reconfirmed passing at closeout (no regression). The mandatory repository-wide broker-submission inventory (`docs/reviews/ES-0002-Broker-Submission-Inventory.md`) also surfaced a second, unrelated, unguarded live-order submission path in `app/rinse-repeat/page.tsx` — documented, not fixed, per this ticket's explicit scope boundary. The temporary branch `feature/pending-order-replacement-safety` has been deleted, locally and remotely. See `docs/reviews/ES-0002-Implementation-Report.md` for the full account.

**TC-0001 — Trade Command Center** is **complete and merged into `main` at merge commit `cfd4080`.** It composes existing Daily Briefing, Today's Priorities, Portfolio Health, Best Opportunity, and Background Task intelligence into a new `/dashboard` landing route. Two architecture conflicts were found against the design spec's assumptions and escalated to the Product Owner rather than resolved by assumption: (1) the shared composition logic needed a new home rather than being duplicated — resolved by extracting `app/portfolio/page.tsx`'s private composition chain into a new shared, pure `lib/portfolio-intelligence/dashboardComposition.ts` module, now consumed by both pages; (2) Next.js forbids exporting shared helpers from a `page.tsx` file — resolved by redesigning the new module's input contract so it needs no import from `page.tsx` at all; (3) `loadPositions()`'s live TastyTrade fetch/enrichment pipeline was found to be a ~4,000-6,000-line, safety-critical subsystem unsafe to relocate in this sprint — the Product Owner directed keeping it untouched in `app/portfolio/page.tsx` initially. **A corrective round** relocated the closed, non-React-coupled portion of that pipeline (a measured 60 symbols / ~1,621 lines) into `lib/tastytrade/client.ts` and `lib/portfolio-data/`, behind a new shared `PortfolioDataProvider` consumed by both `/dashboard` and `/portfolio` — so Daily Briefing, Today's Priorities, and Portfolio Health now render real, live data on `/dashboard`, not a disclosed `unavailable` placeholder. The Best Opportunity card mounted the previously-unmounted `BestOpportunitiesPanel` (OE-0001) for the first time, with real adapter/ranker wiring — no real `DecisionAnalysis[]` feed existed yet at merge time, so it rendered its own honest empty state (this gap is now closed by OE-0002A, below). 32 new tests; full repository regression re-run, 1,034/1,034 tests passing across 74 files at merge; `tsc --noEmit` clean; `git diff --check` clean. The temporary branch `feature/trade-command-center` has been deleted, locally and remotely. See `docs/design/TC-0001-Trade-Command-Center.md` and `docs/reviews/TC-0001-Implementation-Report.md` for the full account.

**PT-0002A — Global Portfolio Mode Foundation** is **complete and merged into `main` at merge commit `ce28842`.** It adds a single, application-wide `PortfolioMode` (`LIVE | PAPER`) abstraction — a hydration-safe provider with versioned persistence, a global mode indicator, a canonical mode-aware contract, and LIVE/PAPER adapters (thin wrappers around `PortfolioDataProvider` and PT-0001's API, respectively) — as tested, ready-to-use infrastructure, with no existing screen wired to consume it yet (deferred to PT-0002B, below). The original round was **rejected**: its indicator exposed a fully working "Switch to PAPER" control while no screen was wired to respond to mode, an ambiguous-context defect. The accepted corrective round removed any way to select PAPER through the indicator, and blocks the shell with a full-screen warning if a legacy PAPER value is ever found persisted, rather than displaying or silently coercing it. The temporary branch `feature/global-portfolio-mode-foundation` has been deleted, locally and remotely. See `docs/design/PT-0002A-Global-Portfolio-Mode-Foundation.md` §9 and `docs/reviews/PT-0002A-Implementation-Report.md` §13.

**PT-0002B — Portfolio Context Integration** is **complete and merged into `main` at merge commit `ee26423`.** It wires `/dashboard` and `/portfolio` to PT-0002A's mode-aware adapters: both pages now read the global `PortfolioMode` and render their LIVE composition only when mode is resolved and confirmed LIVE (a `PortfolioModeGateNotice` placeholder otherwise), and four live broker-submission call sites (`BatchConfirmModal.submitAll`, `SetStopLossButton.submit`, `cancelPendingOrder`, `replacePendingOrder`) are now guarded by a new `assertLiveContextReady(status, mode, action)` function. **A post-merge architecture review found the design document overstated its own implementation** in two respects, both corrected in a documentation-only reconciliation (no code changed): (1) `PortfolioModeIndicator` was never actually reactivated — the PAPER control remains hard-disabled, a fact the design doc had claimed was resolved; (2) six live-brokerage-data surfaces beyond `/dashboard` and `/portfolio` (`/engine`, `/rinse-repeat`, `/screener`, `/long-book`, `/trade-log`, `/performance`) remain outside PortfolioMode awareness entirely — the design doc now carries an explicit acceptance-criterion statement that PT-0002B "does not claim application-wide LIVE/PAPER isolation" and gates only `/dashboard` and `/portfolio`. This is a **known, disclosed, accepted gap**, not a defect requiring a corrective round — closing it (or explicitly classifying each surface as mode-independent) is future work, not yet scoped as its own ticket. See `docs/design/PT-0002B-Portfolio-Context-Integration.md` for the full, corrected account.

**DT-0001 — Decision Transparency** is **complete and merged into `main` at merge commit `6f46936`.** It adds `lib/todaysPriorities/explanation.ts`'s `buildRecommendationExplanation()` — a deterministic, pure "why" layer over already-computed `PortfolioObjective`/`PrioritizedObjective` data (decision drivers deduplicated from evidence and priority reasons, "why now" text reused verbatim from existing review triggers, and a four-tier confidence label derived from the existing numeric confidence score) — with no new scoring or ranking logic. `features/portfolio/dashboard/TodaysPrioritiesDashboard.tsx`'s `PriorityRankedList` cards were extended with a "Confidence" stat, a "Top Decision Drivers" grid, and a "Why Now" checklist. A product-review corrective round clarified the presentation distinction between Priority Score (the ranking metric) and Decision Confidence (the recommendation's confidence) — explicit relabeling, a visual-hierarchy change, and a spacing divider, no business-logic change. **DT-0001 has no dedicated design document** — a known, disclosed gap (unlike every other ticket in this history); its public API, design rationale, and full source are documented in this session's DT-0001 architecture review and product review package correspondence, not in a `docs/design/` file. Creating one is a documentation follow-up, not part of DOC-0001's reconciliation scope (DOC-0001 reconciles existing documents against Git history; it does not author new historical design records). See `lib/todaysPriorities/__tests__/explanation.test.ts` (4 tests) for its test coverage.

**OE-0002A — Opportunity Engine Activation** is **complete and merged into `main` at merge commit `7acb641`.** It activates the OE-0001 foundation for the first time in production: `app/screener/page.tsx` now sends its real, in-memory `ScreenResult[]` scan output through the existing (previously uncalled) `POST /api/autopilot/recommendations` route, then through the existing, unmodified `buildOpportunityRecommendations()` (OE-0001's adapter + ranker), and renders the result with the existing, unmodified `BestOpportunitiesPanel` directly on `/screener`. One new, small, pure module (`lib/command-center/screenerOpportunityRecommendations.ts`) translates the API response shape into that pipeline's input, extracted for testability. No file under `lib/opportunity-engine/`, `lib/decision-engine/`, `lib/todaysPriorities/`, or `lib/autopilot/decision/` was changed; no persistence layer, store, or cross-page synchronization was introduced. `OpportunityContext` is deliberately portfolio-neutral this sprint (`availableCapital: 0`, no exposure fields) to avoid introducing live-account data onto `/screener`, which remains outside PortfolioMode gating (the PT-0002B-documented gap above) — real capital/exposure wiring is deferred to **OE-0003** (see Known Follow-Ups). Quinn's technical review and Paul's product review both approved with no corrective round required. 58 pre-existing Opportunity Engine/Command Center tests passed unchanged; 5 new wiring tests added. The temporary branch `feature/oe-0002a-opportunity-engine-activation` has been deleted, locally and remotely. See `docs/design/OE-0002A-Opportunity-Engine-Activation.md` and `docs/reviews/OE-0002A-Implementation-Report.md` for the full account.

**DOC-0001 — Project Documentation & Repository Reconciliation** is **complete and merged into `main` at merge commit `822e8fc`.** Documentation-only: no application code, tests, configuration, dependencies, or runtime behavior changed. Reconciled `planning/SPRINT_STATUS.md` (this document), `docs/roadmap/ROADMAP.md`, `docs/HANDOFF.md`, `planning/PROJECT_GOVERNANCE.md`, and the design/review documents for TC-0001, PT-0002A, PT-0002B, DT-0001, OE-0001, and OE-0002A against verified Git history, and closed a subsequent narrow corrective round (one remaining stale role-label reference). The temporary branch `feature/doc-0001-project-reconciliation` has been deleted, locally and remotely.

**OE-0002B — Recommendation Service Foundation & Dashboard Integration** is **complete and merged into `main` at merge commit `26bd9e2`.** The original CES asked for `/dashboard`'s Best Opportunity card to share OE-0002A's real Screener-sourced feed directly; before writing code, that approach was found to require either reading the Screener's own IndexedDB scan cache from `/dashboard` (violating the existing, documented "no cross-page state" contract) or reconstructing a `DecisionAnalysis` from the decision log (violating this codebase's "never fabricate" convention, since log entries lack required fields) — this was reported and implementation stopped rather than worked around. The revised CES introduced a new architectural boundary, `lib/recommendations/RecommendationService.ts`: an in-memory, unpersisted, module-singleton pub-sub store that acquires and holds the current, real `DecisionAnalysis[]`. `/screener` became a producer (publishing alongside its existing OE-0002A recommendation effect); `/dashboard` became a pure consumer (`useCurrentRecommendations()`) feeding the same, unmodified `buildOpportunityRecommendations()` OE-0001/TC-0001 always used. A corrective round (Quinn) added a public `lib/recommendations/index.ts` barrel decoupling consumers from the concrete implementation module, and an explicit design-doc note on why the service stores raw `DecisionAnalysis[]` rather than pre-ranked output. Decision Engine and Opportunity Engine were not touched. See `docs/design/OE-0002B-Recommendation-Service-Foundation.md` and `docs/reviews/OE-0002B-Implementation-Report.md`.

**MB-0001A — Morning Briefing Attention Feed** is **complete and merged into `main` at merge commit `8a872aa`.** It adds `lib/morning-briefing/buildAttentionFeed()`: a pure, read-only composition layer that flattens Today's Priorities' existing actionable buckets (`immediateAction`, `reviewToday.{earningsReviews,expiringPositions,mediumPriority}`, `opportunities.{rollOpportunities,cspOpportunities}`) into one globally-ordered `IMMEDIATE`/`WATCH` feed, and `monitor` into `HEALTHY`, introducing no new scoring, actionability, or explanation logic — `PortfolioObjective.actionability`, `calculatePriorityScore()`, and `buildRecommendationExplanation()` are all reused unchanged. **The original implementation (`a0b4f60`) was REJECTED** by Quinn's architecture and QA review on two blocking findings: (1) since `buildTodaysPrioritiesDashboard()` intentionally allows one objective to belong to more than one bucket, the initial flatten produced duplicate `AttentionItem` records for the same decision and inflated counts; (2) `topAttentionItem` was derived from the feed's own source-precedence ordering rather than the existing `selectTopPriority()`, which could disagree with it when different-bucket heads tied at the same score. **The accepted corrective round (`af189e7`)** deduplicates by `objective.id` (walking buckets in source-precedence order, first occurrence wins, identity/score/tier/reasons/explanation of the retained item unchanged) and resolves `topAttentionItem` directly from `selectTopPriority(dashboard)`'s own answer looked up by id, rather than re-deriving it — guaranteeing parity by construction. `selectTopPriority()` and all other existing Today's Priorities behavior were left untouched. Targeted validation at merge: 304/304 tests passing across 22 files (19 in the new `lib/morning-briefing` suite); `tsc --noEmit` clean; `git diff --check` clean; the full repository suite could not complete within this sandbox's per-command time limit (a known, pre-existing, documented environment constraint) but showed zero failures in every partial run. The temporary branch `feature/mb-0001a-attention-feed` has been deleted, locally and remotely. See `docs/design/MB-0001A-Attention-Feed.md`, `docs/reviews/MB-0001A-Implementation-Report.md` (including its Corrective-Round Addendum), `docs/reviews/MB-0001A-Quinn-Architecture-Review.md`, and `docs/reviews/MB-0001A-Quinn-Final-Approval.md` for the full account.

**Every sprint through MB-0001A listed above is accepted, complete, and merged into `main`.** No implementation sprint is currently active. **MB-0001B** (the natural next Morning Briefing step — Dashboard integration of the Attention Feed) is not approved, scoped, or started. **OE-0003 (Optional Opportunity Context)** is queued as planned future work (see Known Follow-Ups and `docs/roadmap/ROADMAP.md`); not approved, scoped, or started. PI-0015 / Portfolio Intelligence corrections remain queued for live-market acceptance validation. `epic/autopilot` remains untouched by every sprint in this document.

## Governance

Project workflow is governed by `planning/PROJECT_GOVERNANCE.md`.

Key operating rules:

- One active sprint at a time.
- Sprint scope freezes after approval.
- New ideas go to the backlog rather than expanding active work.
- Material document revisions are delivered as complete files, not patch instructions.
- Git operations are handled one logical step at a time and verified before proceeding.
- `main` must remain releasable.

Current roles (per the TradeEdge Engineering Operating Model, `planning/PROJECT_GOVERNANCE.md`): **Paul** — Product Owner; **Quinn** — Chief Architect; **Dean** — Lead Engineer / Implementation Lead.

## Branch Policy

- **Long-lived branches:** `main`, `epic/autopilot`.
- **Sprint branches:** `feature/<ticket>-<description>`, deleted locally and remotely after merge.
- `feature/autopilot` is an obsolete name for `epic/autopilot` and should only appear in historical command transcripts, not in active documentation.

## Current Product Rule

Autopilot must produce deterministic, explainable, portfolio-aware recommendations before it is allowed to create paper trades.

No live execution work may begin before paper execution, autonomous paper management, paper beta validation, and an explicit live-readiness review are complete. ("Paper execution" here refers to the still-dormant, **autonomous** Autopilot paper framework — Milestone C / TE-0010, not started — which is distinct from PT-0001's already-complete, **manual**, intentional-action-only paper trading sandbox. See "Completed Capability Tracker" and Milestone C below.)

For TastyTrade scans, execution remains browser-owned and client-authenticated. Do not reintroduce Vercel server-side TastyTrade scan execution until server authentication is explicitly solved.

## Repository State

Verified 2026-07-24 (MB-0001A closeout, current):

- `main` and `origin/main` both at `8a872aa` ("merge: MB-0001A deterministic morning briefing attention feed"), working tree clean on `main`.
- No sprint branch is currently active. `feature/mb-0001a-attention-feed` has been deleted, locally and remotely, per the standard lifecycle, once this merge and closeout were confirmed.
- Local/remote branches present: `main`, `epic/autopilot` (long-lived, untouched). No stale feature branches remain — every temporary branch through MB-0001A has been deleted, locally and remotely.

Verified 2026-07-24 (DOC-0001, superseded by the above):

- `main` and `origin/main` both at `7acb641` ("merge: OE-0002A opportunity engine activation"), working tree clean on `main`.
- Active branch for this sprint: `feature/doc-0001-project-reconciliation`, created off `main` @ `7acb641` (merge-base confirms no divergence beyond this sprint's own commits).
- Local/remote branches present: `main`, `epic/autopilot` (long-lived, untouched), and this sprint's branch. No stale feature branches remain — TC-0001, PT-0002A, PT-0002B, DT-0001, and OE-0002A's temporary branches have all been deleted, locally and remotely, per the standard lifecycle.

Verified 2026-07-18 (ES-0001 closeout review, post-merge):

- `main` and `origin/main` both at `a7f6acb`, working tree clean
- The temporary `feature/manual-paper-trading` branch has been **deleted, both locally and remotely**, per the standard short-lived-branch lifecycle

Verified 2026-07-19 (TC-0001 pre-flight): ES-0002 merged into `main` at `424e068`; `main` and `origin/main` both at `424e068`, confirmed via `git merge-base --is-ancestor`. `feature/pending-order-replacement-safety` deleted, locally and remotely.

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
| PI-0004A | Today's Priorities UI | Complete ✅ | Pure presentation over canonical priorities |
| PI-0004B | Actionability and Wheel Awareness | Complete ✅ | Actionability dimension, strategy and assignment preference awareness |
| PI-0004C | Today's Priorities Workflow | Complete ✅ | Dedicated subpage and persisted Complete/Reopen behavior |
| PI-0006A | Assertive Recommendations | Complete ✅ | Decisive labels and evidence bullets |
| PI-0006B | Intent-Based Recommendation Engine | Complete ✅ | Evidence-scored canonical management intents |
| PI-0007A | Recommendation Scorecard | Complete ✅ | Observable candidate scores, winner, margin, and confidence tier |
| PI-0008A | Remaining Opportunity Engine | Complete ✅ | Opportunity Captured and Remaining Opportunity metrics |
| PI-0012A | Portfolio Review Composition Layer | Complete ✅ | Composes existing health and objective engines; no new scoring or AI |
| PI-0013 | Daily Briefing Dashboard | Complete ✅ | Deterministic priorities, snapshot, opportunities, and risks summary |
| PI-0014 | Marketable Pricing for Risk-Gating, Phase 1 | Complete ✅ | Stop-loss, take-profit, emergency-exit, and Cut Losses gates now consider marketable (executable) pricing alongside mid; `PositionValuation` valuation layer; liquidity-tier classification |
| OE-0001 | Opportunity Engine Foundation | Complete ✅ | Canonical deterministic ranking layer (`lib/opportunity-engine/`) over already-computed Decision Engine evaluations; one candidate adapter compatible with real `DecisionAnalysis` output; production UI (`BestOpportunitiesPanel`) activated by OE-0002A |
| PT-0001 | Manual Paper Trading Sandbox | Complete ✅ | Manual, intentional-action-only paper-trading sandbox for CSP/BPS/BCS/IC (`lib/paper-trading/`), structurally isolated from any live-order path; single precondition-checked Redis Lua `EVAL` atomic ledger+audit+idempotency commit with explicit commit-outcome classification; paper-only API, `/paper-trading` page, and a Portfolio Intelligence adapter reusing the canonical Decision Engine unchanged |
| ES-0001 | Live Close-Order Identity and Break-Even Safety | Complete ✅ | Deterministic economic-structure analysis (`lib/portfolio/closeOrderSafety.ts`) hard-blocks genuinely ambiguous leg pairings instead of merging-and-disclosing; every live close/roll/stop-loss submission structurally routes through one safety gate before reaching the broker; 65 tests |
| ES-0002 | Pending-Order Replacement Safety | Complete ✅ | Closes ES-0001 Closeout TD-1: `replacePendingOrder`'s cancel/resubmit and automatic restore-on-failure route through a dedicated plan/gate/broker-boundary module pair; 58 new tests. Broker inventory found one new, unrelated unguarded live path (`app/rinse-repeat/page.tsx`) — flagged, not fixed |
| TC-0001 | Trade Command Center | Complete ✅ | New `/dashboard` route composing existing Daily Briefing, Today's Priorities, Portfolio Health, Best Opportunity, and Background Task intelligence; shared, pure `lib/portfolio-intelligence/dashboardComposition.ts`; corrective round relocated the closed live-acquisition dependency set into `PortfolioDataProvider` so `/dashboard` renders real, live data; mounted the previously-unmounted `BestOpportunitiesPanel` (OE-0001) for the first time. Merged `cfd4080` |
| PT-0002A | Global Portfolio Mode Foundation | Complete ✅ | Application-wide `PortfolioMode` (`LIVE`\|`PAPER`) infrastructure: provider, versioned persistence, global indicator, mode-aware contract, LIVE/PAPER adapters. Corrective round removed the ability to select PAPER before any screen consumed mode. Infrastructure only — no screen wired yet at merge (deferred to PT-0002B). Merged `ce28842` |
| PT-0002B | Portfolio Context Integration | Complete ✅ | Wires `/dashboard` and `/portfolio` to PT-0002A's adapters; 4 live broker-submission call sites now mode-gated. Post-merge documentation review found the design doc overstated indicator reactivation and full ambiguous-context closure — corrected (no code change); 6 live-brokerage surfaces remain outside PortfolioMode awareness, a disclosed, accepted gap. Merged `ee26423` |
| DT-0001 | Decision Transparency | Complete ✅ | Deterministic "why" layer (`buildRecommendationExplanation()`) over existing `PortfolioObjective`/`PrioritizedObjective` data — decision drivers, why-now evidence, confidence labeling; no new scoring/ranking. Presentation corrective round clarified Priority Score vs. Decision Confidence distinction. No dedicated design document exists (disclosed gap). Merged `6f46936` |
| OE-0002A | Opportunity Engine Activation | Complete ✅ | First production activation of OE-0001: `/screener` scan results now flow through the existing recommendation pipeline and render via the existing `BestOpportunitiesPanel`. Portfolio-neutral by design this sprint (no live capital/exposure). Merged `7acb641` |
| DOC-0001 | Project Documentation & Repository Reconciliation | Complete ✅ | Documentation-only reconciliation of sprint/roadmap/handoff/governance docs against Git history through OE-0002A; narrow corrective round removed one remaining stale role-label reference. Merged `822e8fc` |
| OE-0002B | Recommendation Service Foundation & Dashboard Integration | Complete ✅ | New `lib/recommendations/RecommendationService` acquisition boundary (Screener as producer, Dashboard as consumer) resolves an architecture gap found and escalated rather than worked around; `/dashboard`'s Best Opportunity card now shares OE-0002A's real feed through the existing, unmodified adapter/ranker. Corrective round added a public `index.ts` barrel. Merged `26bd9e2` |
| MB-0001A | Morning Briefing Attention Feed | Complete ✅ | Pure `buildAttentionFeed()` composition layer flattens Today's Priorities' existing buckets into one deduplicated, globally-ordered IMMEDIATE/WATCH/HEALTHY feed; no new scoring/actionability/explanation logic. Corrective round fixed cross-bucket duplicate items and guaranteed `topAttentionItem` parity with the existing `selectTopPriority()`. Merged `8a872aa` |

PI-0012A and PI-0013 were merged to `main` in commit `a90f8f1` (`merge: portfolio intelligence`). PI-0014 was merged to `main` in commit `2c79d5e`. OE-0001 was merged to `main` in commit `c97a705`. PT-0001 was merged to `main` in commit `05d0f31`, with its accepted implementation report finalized in closeout commit `1ffc54a`. ES-0001 was merged to `main` in commit `a7f6acb`. ES-0002 was merged to `main` in merge commit `424e068`. TC-0001 was merged to `main` in merge commit `cfd4080`. PT-0002A was merged to `main` in merge commit `ce28842`. PT-0002B was merged to `main` in merge commit `ee26423`. DT-0001 was merged to `main` in merge commit `6f46936`. OE-0002A was merged to `main` in merge commit `7acb641`. DOC-0001 was merged to `main` in merge commit `822e8fc`. OE-0002B was merged to `main` in merge commit `26bd9e2`. MB-0001A was merged to `main` in merge commit `8a872aa`.

## Validation Baseline

The most recently documented Portfolio Intelligence baseline before PI-0012A/PI-0013 was:

- 398 tests passing repo-wide
- `tsc --noEmit` clean
- Production build attempts subject to the established five-minute environment limit

**PI-0014 (merged, commit `2c79d5e`)**: 643 tests passing repo-wide; `tsc --noEmit` clean.

**OE-0001 (merged, commit `c97a705`)**: 697 tests passing repo-wide; `tsc --noEmit` clean.

**PT-0001 (merged, commit `05d0f31`; closeout `1ffc54a`)**: 182/182 targeted tests; 879/879 tests passing repo-wide across 66 files; `tsc --noEmit` clean; `git diff --check` clean.

**ES-0001 (merged, commit `a7f6acb`)**: 65/65 targeted tests; 944/944 tests passing repo-wide across 68 test files at closeout; `tsc --noEmit` clean.

**ES-0002 (merged, commit `424e068`)**: 58/58 targeted tests; 65/65 ES-0001 tests reconfirmed passing; `tsc --noEmit` clean; `git diff --check` clean.

**TC-0001 (merged, commit `cfd4080`)**: 32/32 new targeted tests; full repository regression, 1,034/1,034 tests passing across 74 files at merge; `tsc --noEmit` clean; `git diff --check` clean.

**PT-0002A (merged, commit `ce28842`)**: see `docs/reviews/PT-0002A-Implementation-Report.md` §13 for the corrective round's targeted test results; no regression against TC-0001's baseline.

**PT-0002B (merged, commit `ee26423`)**: 4 mode-gated call sites covered by targeted tests; see `docs/design/PT-0002B-Portfolio-Context-Integration.md` for full test evidence.

**DT-0001 (merged, commit `6f46936`)**: 4 targeted tests (`lib/todaysPriorities/__tests__/explanation.test.ts`); presentation corrective round verified via `tsc --noEmit` and `vitest run lib/todaysPriorities` (26/26 passing).

**OE-0002A (merged, commit `7acb641`)**: 58 pre-existing Opportunity Engine/Command Center tests passing unchanged; 5 new wiring tests (`lib/command-center/__tests__/screenerOpportunityRecommendations.test.ts`); `tsc --noEmit` clean; `git diff --check` clean.

**OE-0002B (merged, commit `26bd9e2`)**: 69/69 targeted tests across `lib/recommendations`, `lib/command-center`, `lib/opportunity-engine` (7 new for the Recommendation Service); `tsc --noEmit` clean; `git diff --check` clean.

**MB-0001A (merged, commit `8a872aa`)**: 304/304 targeted tests across `lib/morning-briefing`, `lib/todaysPriorities`, `lib/priorityScore`, `lib/portfolio-intelligence`, `lib/dailyBriefing`, `lib/command-center` (19 in the new `lib/morning-briefing` suite, up from 13 after the corrective round); `tsc --noEmit` clean; `git diff --check` clean; full repository suite could not complete within this sandbox's per-command time limit (documented, pre-existing environment constraint) but showed zero failures across 30+ files in partial runs.

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

**Status:** Partial 🟡

Goal: Autopilot can create simulated trades through an explicit, auditable, kill-switch-controlled paper execution engine.

**PT-0001 (manual, intentional-action-only paper ledger) and PT-0002A/PT-0002B (application-wide LIVE/PAPER context, gated on `/dashboard` and `/portfolio`) are complete and merged.** The **autonomous** Autopilot-driven paper trading component of this milestone (TE-0010) remains not started.

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

### Opportunity Engine

- **OE-0002B is complete** (see Current State and the Completed Capability Tracker above) — `/dashboard`'s `BestOpportunityCard` now shares OE-0002A's real feed via `lib/recommendations/RecommendationService`.
- **OE-0003 — Optional Opportunity Context (planned, not started):** wire real, portfolio-mode-gated capital/exposure data into `OpportunityContext` (currently `availableCapital: 0`, no exposure fields, by deliberate OE-0002A design, and still unchanged by OE-0002B). Accepted by Quinn and Paul as a future architectural enhancement. Contingent on resolving `/screener`'s PortfolioMode gating question (see below).

### Morning Briefing

- **MB-0001A is complete** (see Current State and the Completed Capability Tracker above) — `lib/morning-briefing/buildAttentionFeed()` provides a deduplicated, deterministically-ordered attention feed with guaranteed top-item parity against the existing `selectTopPriority()`.
- **MB-0001B (planned, not started, not yet scoped):** the natural next Morning Briefing step — deciding whether/how the Attention Feed reaches `/dashboard` (compatible with, but distinct from, OE-0002B's Recommendation Service pattern per Quinn's MB-0001A final approval). Not approved or started; do not begin without an approved CES.
- A theoretical, non-blocking tie-break divergence between `orderedActionable`'s display order and `selectTopPriority()`'s own iteration order remains possible for scores tied across bucket pairs not covered by MB-0001A's corrective-round parity tests beyond the three identified conflicts — `topAttentionItem` itself is unaffected (resolved directly from `selectTopPriority()`), only `orderedActionable`'s own display ranking among a tie could read differently from a naive expectation. Documented, not a defect.

### Portfolio Mode

- Six live-brokerage-data surfaces (`/engine`, `/rinse-repeat`, `/screener`, `/long-book`, `/trade-log`, `/performance`) remain outside PortfolioMode awareness — a disclosed, accepted PT-0002B gap, not yet scoped as its own ticket. `PortfolioModeIndicator`'s PAPER control remains hard-disabled pending a decision on closing this gap or explicitly classifying each surface as mode-independent.
- A second, unrelated unguarded live-order path (`app/rinse-repeat/page.tsx`'s OTOCO entry submission) was found during ES-0002's mandatory broker inventory (`docs/reviews/ES-0002-Broker-Submission-Inventory.md`, item 11) — candidate ES-0003 in the broker-safety numbering (distinct from the Opportunity Engine's OE-0003 above), not yet scoped.

### Decision Transparency

- DT-0001 has no dedicated design document — a documentation follow-up, not a code gap.
- A DT-0001-style explanation adapter for Opportunity Engine recommendations was assessed (during OE-0002A's architecture discovery) as not directly reusable without new adapter code, since `OpportunityRecommendation`'s fields are already-flattened strings rather than DT-0001's structured evidence/trigger model. Not scoped as a ticket.

### Portfolio Intelligence acceptance

- Use Portfolio Review and Daily Briefing with real positions across several trading sessions.
- Verify that the highest-priority recommendations are correct, non-duplicative, and actionable.
- Confirm empty, healthy, concentrated, earnings-risk, profit-target, material-loss, and assignment-preferred scenarios.
- Confirm no contradictory recommendation appears across Portfolio Review, Daily Briefing, Today's Priorities, and Position Intelligence.

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

**Every sprint through MB-0001A is accepted, complete, and merged.** No implementation sprint is currently active. No implementation sprint is currently selected as "next" — that determination belongs to the Product Owner, guided by the candidates below (not ranked; ranking is a Product Owner decision):

1. **MB-0001B** — decide whether/how the Attention Feed reaches `/dashboard`. Not yet scoped.
2. **OE-0003 — Optional Opportunity Context** — wire real capital/exposure data into the Opportunity Engine, contingent on a PortfolioMode decision for `/screener`.
3. Closing the six-surface PortfolioMode gap disclosed by PT-0002B, or explicitly classifying those surfaces as mode-independent.
4. The second unguarded live-order path in `app/rinse-repeat/page.tsx` (ES-0002 Broker-Submission-Inventory item 11).
5. PI-0015 / Portfolio Intelligence real-world acceptance validation.
6. TE-0008 — Capital Allocation / Wheel Preference Engine.
7. TE-0009 — Income Engine Foundation.
8. A dedicated DT-0001 design document (documentation follow-up).

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
