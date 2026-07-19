# Trade Edge Roadmap

## Current Branch

`main` is the primary branch. `feature/autopilot` is the long-lived Autopilot development branch, untouched by ES-0001, ES-0002, or TC-0001. `feature/opportunity-engine-foundation` (OE-0001) has been merged into `main` and deleted, locally and remotely. `feature/manual-paper-trading` (PT-0001, Manual Paper Trading Sandbox) has been merged into `main` (merge commit `05d0f31`, closeout commit `1ffc54a`) and deleted, locally and remotely. `feature/live-close-safety` (ES-0001, Live Close-Order Identity and Break-Even Safety) went through a rejected first implementation round and a rejected first corrective round before an accepted round 2 (deterministic economic-structure analysis, an all-block safety gate, a structurally-enforced broker boundary), and has been **merged into `main` at merge commit `a7f6acb`**. See `docs/design/ES-0001-Live-Close-Order-Safety.md`, `docs/reviews/ES-0001-Implementation-Report.md`, and the post-merge closeout review at `docs/reviews/ES-0001-Closeout-Report.md` (architectural review, technical debt register, test coverage assessment, and next-sprint recommendation — including one pre-existing, out-of-scope live-order path, `replacePendingOrder`, found still bypassing this safety gate).

**`feature/pending-order-replacement-safety` (ES-0002, Pending-Order Replacement Safety) is complete and merged into `main`** at merge commit `424e068`. `main` and `origin/main` are both at `424e068`. It closes ES-0001 Closeout Technical Debt TD-1 (the `replacePendingOrder` gap named above) with a dedicated, framework-free plan/gate/broker-boundary module pair (`lib/portfolio/pendingOrderReplacementSafety.ts`, `lib/portfolio/pendingOrderReplacementSubmission.ts`). The temporary branch `feature/pending-order-replacement-safety` has been deleted, locally and remotely. See `docs/design/ES-0002-Pending-Order-Replacement-Safety.md`, `docs/reviews/ES-0002-Implementation-Report.md`, and `docs/reviews/ES-0002-Broker-Submission-Inventory.md`.

**`feature/trade-command-center` (TC-0001, Trade Command Center)'s corrective round is committed (`3385d23`, plus a documentation follow-up at `2827ad9`) and pushed to `origin/feature/trade-command-center`, awaiting Product Owner review before merge** — a new `/dashboard` route composing existing Daily Briefing, Today's Priorities, Portfolio Health, Best Opportunity (Opportunity Engine), and Background Task intelligence into one morning landing dashboard, via a new shared, pure composition module (`lib/portfolio-intelligence/dashboardComposition.ts`) and a shared `PortfolioDataProvider` also now consumed by `app/portfolio/page.tsx`. See `docs/design/TC-0001-Trade-Command-Center.md` and `docs/reviews/TC-0001-Implementation-Report.md`.

**`feature/global-portfolio-mode-foundation` (PT-0002A, Global Portfolio Mode Foundation)'s corrective round is complete, awaiting Product Owner review** — branched from `feature/trade-command-center` @ `2827ad9`. Adds a single, application-wide `PortfolioMode` (`LIVE | PAPER`) abstraction: a hydration-safe provider with versioned persistence, an unmistakable global mode indicator, a canonical mode-aware contract, and LIVE/PAPER adapters (thin wrappers around the existing `PortfolioDataProvider` and PT-0001's API, respectively) — infrastructure only, no existing screen wired to consume it yet (deferred to PT-0002B). The original round was rejected because its indicator exposed a working PAPER switch while no screen responded to mode, letting the shell display PAPER over live data; the corrective round removes any way to select PAPER through the UI and blocks the shell if a legacy PAPER value is ever found persisted, rather than displaying or silently coercing it. Not committed, not pushed, not merged. See `docs/design/PT-0002A-Global-Portfolio-Mode-Foundation.md` §9 and `docs/reviews/PT-0002A-Implementation-Report.md` §13.

For the authoritative, up-to-date operational status (what's merged, what's active, validation baselines, known follow-ups), see `planning/SPRINT_STATUS.md`. This document is intentionally high-level and forward-looking; it does not duplicate that tracker's detail and can lag it between updates.

## Completed Platform / Infrastructure

- TE-0001 — Background Task Manager Requirements
- TE-0002 — Task Manager and Command Bus Architecture
- TE-0003 — Implement Task Manager Foundation
- TE-0004 — Implement Command Bus Foundation
- TE-0005A — Background Ranked Scan Infrastructure
- RF-0001 — Establish Feature-Oriented Screener Module
- TE-0005B — Global Background Task Status Bar
- TE-0005C — Task Completion Notifications
- TE-0005D — Global Task Drawer
- TE-0007A — First-Class CSP Screener Strategy (reuses Wheel's contract search; see `docs/reviews/TE-0007A-Implementation-Report.md`)

## Completed Trader Intelligence

- TE-0006A — Portfolio Health Scoring Framework (consolidated into `lib/portfolio-intelligence` in PI-0002)
- TE-0006B — Portfolio Recommendation Rules (consolidated into `lib/portfolio-intelligence` in PI-0002, now produces canonical `PortfolioObjective[]`)
- TE-0006C — Daily Priority List (consolidated into the canonical `prioritizePortfolioObjectives()`)
- Sprint 2 — Decision Engine (`lib/decision-engine`, `lib/autopilot/decision`) — merged to `main`, live in production. Canonical per-candidate evaluation contract (DR-0002): deterministic recommendations, full reasoning, kill switch, deduplication, audit trail.
- PI-0001 — Portfolio Objective Engine (`lib/portfolio-intelligence`) — canonical deterministic portfolio objectives
- PI-0002 — Portfolio Engine Consolidation — TE-0006A/B moved into the canonical model, `app/portfolio/page.tsx` a consumer, stable rule IDs
- PI-0003 — Canonical Portfolio Priority Engine — risk policy separation, fine-grained rule IDs, canonical `prioritizePortfolioObjectives()`
- PI-0003.5 — Real Financial Data Wiring — objective rules now fire from real account balances via a single normalization point
- PI-0004A — Today's Priorities UI — first UI surface for canonical Portfolio Intelligence
- PI-0004B — Actionability and Wheel Awareness — actionability dimension, strategy/assignment preference awareness
- PI-0004C — Today's Priorities Workflow — dedicated subpage, persisted Complete/Reopen
- PI-0004D — Daily Portfolio Briefing — 30-second executive summary over the canonical objective list, default `/portfolio` tab
- PI-0005 — Position Intelligence — expandable per-position panel explaining the canonical recommendation (why, evidence, concerns, alternatives) with zero new evaluation rules
- PI-0006A — Assertive Recommendations — decisive labels and evidence bullets
- PI-0006B — Intent-Based Recommendation Engine — evidence-scored canonical management intents
- PI-0007A — Recommendation Scorecard — observable candidate scores, winner, margin, confidence tier
- PI-0008A — Remaining Opportunity Engine — Opportunity Captured and Remaining Opportunity metrics
- PI-0008B — Decision Quality V1 — centralized recommendation-weighting matrix; Net Edge, technical trend, and gamma/DTE risk carry more influence, Remaining Opportunity and earnings proximity became genuine scoring inputs
- PI-0012A — Portfolio Review Composition Layer — composes existing health/objective engines, no new scoring or AI
- PI-0013 — Daily Briefing Dashboard — deterministic priorities, snapshot, opportunities, and risks summary
- PI-0014 — Marketable Pricing for Risk-Gating, Phase 1 — stop-loss/take-profit/emergency-exit/Cut Losses gates now consider marketable (executable) pricing; liquidity-tier classification

**TE-0007 — Opportunity Engine Foundation** is complete, implemented via **OE-0001**, merged into `main` at commit `c97a705`. It adds `lib/opportunity-engine/`, a deterministic ranking layer over already-computed Decision Engine evaluations, and a candidate adapter (`DecisionAnalysis → OpportunityCandidate`) compatible with real Decision Engine output, though no production route calls it yet. A read-only "Best Opportunities" panel (`components/opportunity-engine/BestOpportunitiesPanel.tsx`) was built and tested but **left intentionally unmounted at the time** — a first attempt to mount it as an empty Income Engine tab was rejected by the Product Owner. **TC-0001 (below, pending Product Owner review) mounts this panel for the first time**, on the new `/dashboard` route, with real adapter/ranker wiring — though no real `DecisionAnalysis[]` feed exists yet to populate it, so it still renders its own honest empty state in production today. See `docs/design/OE-0001-Opportunity-Engine-Foundation.md` and `docs/reviews/OE-0001-Implementation-Report.md` for the OE-0001 account, and `docs/design/TC-0001-Trade-Command-Center.md`/`docs/reviews/TC-0001-Implementation-Report.md` for the mounting.

Note: some of the items above (PI-0004D, PI-0005, PI-0008B) are not currently reflected in `planning/SPRINT_STATUS.md`'s Completed Capability Tracker table. They are included here on the basis of their own implementation specs/reports in `planning/` and `docs/reviews/`; reconciling that tracker table is a documentation follow-up, not part of the OE-0001 sprint.

**PT-0001 — Manual Paper Trading Sandbox** is **complete and merged into `main`** (merge commit `05d0f31`; closeout commit `1ffc54a`). It adds `lib/paper-trading/`, a manual (not autonomous) paper-trading domain supporting CSP/BPS/BCS/IC, a dedicated `/api/paper-trading/*` API, a new `/paper-trading` page, and a Portfolio Intelligence adapter for the paper portfolio. Its accepted atomic commit design uses a single precondition-checked Redis Lua `EVAL` (not `WATCH`/`MULTI`/`EXEC`), with every commit-path error classified as `CONFIRMED_NOT_COMMITTED`, `OUTCOME_UNKNOWN`, or `INTEGRITY_FAILURE` — only `CONFIRMED_NOT_COMMITTED` may produce a rejected audit event. It is distinct from, and does not touch, the separate (still-dormant) Autopilot paper framework referenced by TE-0010 below. PT-0001 is the **ledger and sandbox foundation** — a standalone accounting/persistence engine and its own minimal UI, not the final application-wide user experience for choosing between live and paper context; that UX-level integration is PT-0002, immediately below. The temporary branch `feature/manual-paper-trading` has been deleted, locally and remotely. See `docs/design/PT-0001-Manual-Paper-Trading-Sandbox.md` and `docs/reviews/PT-0001-Implementation-Report.md`.

**PT-0002 — Application-Wide Portfolio Mode Foundation** is **queued, not approved, not started.** It builds on PT-0001's now-accepted ledger/sandbox foundation to make LIVE vs. PAPER an explicit, first-class, application-wide concept rather than a feature confined to the `/paper-trading` page. PT-0001's acceptance satisfies this ticket's dependency but does not itself approve or start it — it still requires explicit Product Owner approval and scoping. Required scope:

- A persistent, global LIVE/PAPER selector — not a per-page toggle.
- Unmistakable mode display across every portfolio-dependent screen, so it is never ambiguous which context the user is looking at.
- A shared portfolio-context abstraction that Portfolio Intelligence, Decision Engine inputs, the Daily Briefing, Portfolio Review, risk analysis, analytics, and the Opportunity Engine all read from — no page independently re-deriving "which portfolio am I showing."
- Complete data isolation between live and paper contexts: no blending, no implicit copying of one into the other.
- Mode selection persists across navigation and page refresh.
- Safe failure when context is missing or ambiguous — never silently default to live data, and never silently default to paper data either; fail visibly and require an explicit selection.
- The active mode is displayed at every execution-like confirmation step, not just in a header badge.
- Actions taken while in PAPER mode can mutate only the paper ledger (PT-0001's `paperTrading` field) — never a live position, order, or account value.
- No sequence of mode switches can trigger, enable, or shortcut live order execution. Switching modes is purely a display/read-context change; it is not, and must never become, a live-trading control.
- Autopilot remains disabled and explicitly out of scope for PT-0002 — this ticket does not activate or extend the dormant Autopilot Decision Engine paper framework.

See `docs/design/PT-0001-Manual-Paper-Trading-Sandbox.md`'s note on this sequencing; PT-0002 does not yet have its own design doc — that is the first deliverable when this ticket is approved and scoped.

**ES-0001 — Live Close-Order Identity and Break-Even Safety** is **complete and merged into `main`** (merge commit `a7f6acb`). It replaces broad symbol+expiration position grouping with deterministic economic-structure analysis (`lib/portfolio/closeOrderSafety.ts`) that hard-blocks any genuinely ambiguous leg pairing instead of merging-and-disclosing it, fixes a critical 100x broker-price-unit defect found during corrective review, and structurally enforces (not just tests) that every live close/roll/stop-loss submission passes through a single safety gate before reaching the broker (`lib/portfolio/closeOrderSubmission.ts`). A post-merge closeout review (`docs/reviews/ES-0001-Closeout-Report.md`) found one pre-existing, out-of-scope live-order path — `replacePendingOrder` (GTC/pending-order repricing) — that still bypasses this gate entirely, and recommends it as the next sprint (ES-0002).

**ES-0002 — Pending-Order Replacement Safety** is **complete and merged into `main`** at merge commit `424e068`. It closes the `replacePendingOrder` gap named above: a new `lib/portfolio/pendingOrderReplacementSafety.ts`/`pendingOrderReplacementSubmission.ts` module pair validates a canonical replacement/restore plan built from the broker-sourced pending order (not a fabricated `CanonicalCloseIdentity` — a pending order has no fill economics to build one from) and structurally enforces that both the replacement and the automatic restore-on-failure submission reach `ttPost` only through a hard-blocking, broker-mock-tested boundary that validates the exact broker payload, including hard-blocking missing or malformed price and price-effect values and rejecting one-cent payload drift via exact integer-cent comparison (a pre-approval corrective round fixed both). 58 new tests, 65/65 ES-0001 tests reconfirmed passing (no regression; ES-0001 unaffected). The temporary branch `feature/pending-order-replacement-safety` has been deleted, locally and remotely. See `docs/design/ES-0002-Pending-Order-Replacement-Safety.md`, `docs/reviews/ES-0002-Implementation-Report.md`, and `docs/reviews/ES-0002-Broker-Submission-Inventory.md` (which also flags a second, unrelated unguarded live-order path discovered in `app/rinse-repeat/page.tsx`, deferred pending a separate Product Owner scoping decision).

**TC-0001 — Trade Command Center** is **implemented on `feature/trade-command-center`, awaiting Product Owner review** — not committed, not pushed, not merged. It composes existing Daily Briefing, Today's Priorities, Portfolio Health, Best Opportunity, and Background Task intelligence into a new `/dashboard` landing route, via a new shared pure composition module (`lib/portfolio-intelligence/dashboardComposition.ts`) that both this new route and `app/portfolio/page.tsx` now consume — introduced no new recommendation/scoring logic, and mounts the previously-unmounted `BestOpportunitiesPanel` (OE-0001) for the first time, real adapter/ranker wiring included, though no real `DecisionAnalysis[]` feed exists yet to populate it (disclosed, out of scope). 32 new tests; full 1,034-test repository regression passing; `tsc --noEmit` clean; `git diff --check` clean. See `docs/design/TC-0001-Trade-Command-Center.md` and `docs/reviews/TC-0001-Implementation-Report.md`.

## Current Planning Focus

### Phase 3 — Trader Intelligence Master Specification

See:

`docs/specifications/TradeEdge-Phase3-Master-Specification.md`

Phase 3 shifts the product from infrastructure toward trader-facing intelligence. Sprint 3's Portfolio Intelligence layer (`lib/portfolio-intelligence`) and OE-0001's Opportunity Engine layer (`lib/opportunity-engine`) are the current implementations of this shift's portfolio- and opportunity-level reasoning.

## Near-Term Roadmap

1. **TC-0001 — Trade Command Center** — corrective round committed (`3385d23`) and pushed to `origin/feature/trade-command-center`, awaiting Product Owner review before merge (see `docs/reviews/TC-0001-Implementation-Report.md` §11). `/dashboard` now shares live portfolio composition with `/portfolio` via a new `PortfolioDataProvider`, so Daily Briefing, Today's Priorities, and Portfolio Health render real, live data — only the Best Opportunity panel remains a legitimately empty state pending a live `DecisionAnalysis[]` feed.
2. **PT-0002A — Global Portfolio Mode Foundation** — corrective round complete on `feature/global-portfolio-mode-foundation`, awaiting Product Owner review (see `docs/reviews/PT-0002A-Implementation-Report.md` §13); not committed, not pushed, not merged. Delivers the `PortfolioMode` type/provider/persistence/global indicator and LIVE/PAPER adapters as tested, ready-to-use infrastructure; no existing screen consumes it yet. The original round's global indicator exposed a working PAPER switch with no screen wired to respond to it — corrected: no control can select PAPER this round, and a legacy-persisted PAPER value blocks the shell rather than being silently shown or coerced.
3. PT-0002B — wire `/dashboard` and `/portfolio` to the new mode-aware adapters, and wire the new guardrails into real broker-submission/paper-mutation call sites (deferred from PT-0002A, not yet an approved sprint)
4. Establish a real, live `DecisionAnalysis[]` acquisition mechanism so the Best Opportunity card (wired by TC-0001) has a real feed to rank instead of always rendering its empty state
5. PI-0015 / Portfolio Intelligence real-world acceptance validation (see `planning/SPRINT_STATUS.md` "Known Follow-Ups")
6. TE-0008 — Capital Allocation / Wheel Preference Engine
7. TE-0009 — Income Engine Foundation

### Paper Trading Sequencing

This sequence is a strict dependency order — each step requires the prior step to be approved and accepted before starting, not merely started:

1. **PT-0001 — Manual Paper Trading Sandbox** (complete, merged into `main` at `05d0f31`) — the ledger/persistence/accounting foundation and a minimal manual UI.
2. **PT-0002 — Application-Wide Portfolio Mode Foundation** (queued, not approved, not started) — makes LIVE/PAPER a first-class, application-wide context rather than a page-local feature.
3. Separately approved paper-action integration into the rest of the product (e.g. taking a paper action directly from Portfolio Intelligence recommendations, the Daily Briefing, or the Opportunity Engine) — **not yet scoped, not yet a ticket.**
4. **TE-0010 — Autopilot Paper Mode** — only after manual paper mode (PT-0001 + PT-0002) is proven out. Autopilot activation is not implied or accelerated by either PT-0001 or PT-0002.

## Later Backlog — Paper Strategy Laboratory

### PF-0001 — Multi-Portfolio Support

**Timing:** After Paper Beta and before Live Readiness / live execution work.

**Goal:** Allow one user to create and manage multiple isolated portfolios so different asset sets, allocation models, and trading strategies can be tested independently.

Examples:

- Conservative Wheel
- Aggressive Income
- Growth + LEAPS
- Retirement Income
- Defined-Risk Spreads
- Sector-specific experiments
- What-if sandbox portfolios
- Future live taxable, IRA, Roth IRA, and HSA portfolios

Core requirements:

- Multiple named portfolios per user
- Independent cash, buying power, net liquidity, positions, pending orders, decision history, and performance history
- Separate Portfolio Health, Portfolio Objectives, Daily Briefings, analytics, and Autopilot configuration per portfolio
- Portfolio switcher with clear active-portfolio context
- Clone portfolio to create a new experiment
- Rename, archive, restore, and delete with safeguards
- Side-by-side comparison of strategy results in a later enhancement

Decision Engine requirement:

Every portfolio-aware operation must be explicitly scoped by `portfolioId`. No hidden global active-portfolio state may be used inside domain logic.

Examples:

```text
evaluatePortfolio(portfolioId, context)
evaluateCandidate(portfolioId, candidate, context)
runPortfolioObjectives(portfolioId, context)
```

Paper-trading requirement:

- Paper fills and paper account mutations must be isolated by portfolio.
- Idempotency keys must include `portfolioId`.
- Risk limits, kill switch state, thresholds, and strategy permissions must be configurable per portfolio.
- Analytics must support both per-portfolio results and aggregate comparison without mixing ledgers.

Exit criteria for the future implementation:

- Two or more paper portfolios can run different strategies without shared state leakage.
- The same candidate can receive different recommendations in different portfolios because portfolio context differs.
- Cash, positions, performance, objectives, and audit history remain isolated.
- No live-account capability is introduced as part of the initial multi-portfolio release.

## Core Product Engines

1. Opportunity Engine — Where should my next dollar go? (`lib/opportunity-engine`, OE-0001 foundation complete and merged; mounted on `/dashboard` by TC-0001, pending Product Owner review, still rendering its empty state pending a live candidate feed — the only remaining disclosed gap after TC-0001's corrective round)
2. Portfolio Engine — What should I do with what I already own? (`lib/portfolio-intelligence`, PI-0001 + PI-0002 + PI-0003 complete)
3. Risk Engine — What could hurt me?
4. Income Engine — Am I producing enough recurring income? (`app/engine/page.tsx` — SPX/SPY/Wheel capital-allocation dashboard; not yet unified with the Decision Engine or Opportunity Engine)
5. Execution Engine — What do I actually need to do today?

## Working Model

- Dean: Product Owner / Trader
- ChatGPT: Chief Architect / Reviewer
- Claude/Gemini: Implementation Engineer
- Vercel: authoritative build validation after push
