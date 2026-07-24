# Trade Edge Roadmap

## Current Branch

`main` is the primary branch, at merge commit `7acb641` ("merge: OE-0002A opportunity engine activation") as of 2026-07-24. `epic/autopilot` is the long-lived Autopilot development branch (previously named `feature/autopilot`; that name is obsolete and should only appear in historical command transcripts), untouched by every sprint below. Every sprint through **OE-0002A** has been merged into `main` and its temporary branch deleted, locally and remotely, per the standard short-lived-branch lifecycle: `feature/opportunity-engine-foundation` (OE-0001), `feature/manual-paper-trading` (PT-0001), `feature/live-close-safety` (ES-0001), `feature/pending-order-replacement-safety` (ES-0002), `feature/trade-command-center` (TC-0001), `feature/global-portfolio-mode-foundation` (PT-0002A), `feature/portfolio-context-integration` (PT-0002B), `feature/dt-0001-decision-transparency` (DT-0001), and `feature/oe-0002a-opportunity-engine-activation` (OE-0002A). **DOC-0001** (this reconciliation) is the current active sprint, on `feature/doc-0001-project-reconciliation`.

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
- **TE-0007 — Opportunity Engine Foundation**, implemented via **OE-0001** — `lib/opportunity-engine/`, a deterministic ranking layer over already-computed Decision Engine evaluations, and a real candidate adapter. Merged `c97a705`.
- **PT-0001 — Manual Paper Trading Sandbox** — `lib/paper-trading/`, a manual (not autonomous) paper-trading domain for CSP/BPS/BCS/IC, a dedicated `/api/paper-trading/*` API, a `/paper-trading` page. Merged `05d0f31`.
- **ES-0001 — Live Close-Order Identity and Break-Even Safety** — deterministic economic-structure analysis hard-blocks ambiguous leg pairings; every live close/roll/stop-loss submission structurally routes through one safety gate. Merged `a7f6acb`.
- **ES-0002 — Pending-Order Replacement Safety** — closes the `replacePendingOrder` gap ES-0001's closeout identified. Merged `424e068`.
- **TC-0001 — Trade Command Center** — new `/dashboard` route composing existing intelligence, shared `PortfolioDataProvider`, first mount of `BestOpportunitiesPanel`. Merged `cfd4080`.
- **PT-0002A — Global Portfolio Mode Foundation** — application-wide `PortfolioMode` (`LIVE`\|`PAPER`) infrastructure. Merged `ce28842`.
- **PT-0002B — Portfolio Context Integration** — wires `/dashboard`/`/portfolio` and 4 broker-submission call sites to PT-0002A's mode-aware adapters. Merged `ee26423`.
- **DT-0001 — Decision Transparency** — deterministic decision-driver/why-now/confidence explanation layer over Today's Priorities. Merged `6f46936`.
- **OE-0002A — Opportunity Engine Activation** — first production activation of the Opportunity Engine, wired through `/screener`. Merged `7acb641`.

Note: some items above (PI-0004D, PI-0005, PI-0008B) are not currently reflected in `planning/SPRINT_STATUS.md`'s Completed Capability Tracker table. They are included here on the basis of their own implementation specs/reports in `planning/` and `docs/reviews/`; reconciling that tracker table remains an open documentation follow-up.

## Opportunity Engine — Activation History

**OE-0001** (merged `c97a705`) built the canonical foundation but its production UI (`BestOpportunitiesPanel`) was deliberately left unmounted — a first attempt to mount it as an empty Income Engine tab was rejected by the Product Owner, since an unmounted, finished component was preferable to a production surface with nothing behind it.

**TC-0001** (merged `cfd4080`) mounted that panel for the first time, on `/dashboard`, with real adapter/ranker wiring — but no real `DecisionAnalysis[]` feed existed anywhere in the app yet, so it rendered its own honest empty state.

**OE-0002A** (merged `7acb641`) closed that gap: `/screener`'s real scan output now flows through the existing, previously-uncalled `/api/autopilot/recommendations` route and the existing OE-0001 adapter/ranker, rendering real ranked recommendations via the same, unmodified `BestOpportunitiesPanel` — directly on `/screener`. `OpportunityContext` is deliberately portfolio-neutral (`availableCapital: 0`, no exposure fields) to avoid introducing live-account data onto `/screener`, which is not yet PortfolioMode-gated.

**Planned, not started:**

- **OE-0002B — Dashboard Integration**: decide whether/how `/dashboard`'s `BestOpportunityCard` (still passing a hardcoded empty feed) should share OE-0002A's real feed.
- **OE-0003 — Optional Opportunity Context**: wire real, portfolio-mode-gated capital/exposure data into `OpportunityContext`, once `/screener`'s PortfolioMode gating question is resolved. Accepted by Quinn and Paul as a future architectural enhancement during OE-0002A's technical review — not part of OE-0002A itself.

See `docs/design/OE-0001-Opportunity-Engine-Foundation.md`, `docs/design/TC-0001-Trade-Command-Center.md`, and `docs/design/OE-0002A-Opportunity-Engine-Activation.md` for the full account of each stage.

## Portfolio Mode — Foundation and Integration History

**PT-0001** (merged `05d0f31`) is the ledger and sandbox foundation — a standalone accounting/persistence engine and its own minimal UI, not the final application-wide user experience for choosing between live and paper context.

**PT-0002A** (merged `ce28842`) added the application-wide `PortfolioMode` (`LIVE`\|`PAPER`) abstraction as tested, ready-to-use infrastructure — provider, versioned persistence, global indicator, mode-aware contract, LIVE/PAPER adapters — with no existing screen wired to consume it yet.

**PT-0002B** (merged `ee26423`) wired `/dashboard` and `/portfolio` to those adapters, and gated 4 live broker-submission call sites. A post-merge documentation review found the design doc had overstated two things — `PortfolioModeIndicator` reactivation (still hard-disabled) and full ambiguous-context closure (six surfaces — `/engine`, `/rinse-repeat`, `/screener`, `/long-book`, `/trade-log`, `/performance` — remain outside PortfolioMode awareness) — both corrected in the design document with no code change. This is a **disclosed, accepted gap**, not yet scoped as its own ticket: closing it, or explicitly classifying each surface as mode-independent, is future work.

See `docs/design/PT-0002A-Global-Portfolio-Mode-Foundation.md` and `docs/design/PT-0002B-Portfolio-Context-Integration.md` for the full account.

## Current Planning Focus

### Phase 3 — Trader Intelligence Master Specification

See:

`docs/specifications/TradeEdge-Phase3-Master-Specification.md`

Phase 3 shifts the product from infrastructure toward trader-facing intelligence. Sprint 3's Portfolio Intelligence layer (`lib/portfolio-intelligence`), OE-0001's Opportunity Engine layer (`lib/opportunity-engine`), and DT-0001's decision-transparency layer (`lib/todaysPriorities/explanation.ts`) are the current implementations of this shift's portfolio-, opportunity-, and explanation-level reasoning.

## Near-Term Roadmap

Every item below is either **planned, not started** or **queued for a Product Owner scoping decision** — no implementation sprint is currently active besides DOC-0001's documentation reconciliation.

1. **OE-0002B — Dashboard Integration** (planned, not started) — wire `/dashboard`'s Best Opportunity card to OE-0002A's real feed, if approved, without introducing a new persistence layer.
2. **OE-0003 — Optional Opportunity Context** (planned, not started) — real capital/exposure data for the Opportunity Engine, contingent on a PortfolioMode decision for `/screener`.
3. Close the six-surface PortfolioMode gap disclosed by PT-0002B, or explicitly classify those surfaces as mode-independent (not yet scoped as a ticket).
4. A follow-on to address the second unguarded live-order path discovered during ES-0002's mandatory broker inventory (`app/rinse-repeat/page.tsx`'s OTOCO entry submission — see `docs/reviews/ES-0002-Broker-Submission-Inventory.md`, item 11) — candidate ES-0003 (broker-safety numbering, distinct from the Opportunity Engine's OE-0003 above).
5. PI-0015 / Portfolio Intelligence real-world acceptance validation (see `planning/SPRINT_STATUS.md` "Known Follow-Ups").
6. TE-0008 — Capital Allocation / Wheel Preference Engine.
7. TE-0009 — Income Engine Foundation.
8. A dedicated DT-0001 design document (documentation follow-up; DT-0001 is complete and merged but, unlike every other ticket, has no `docs/design/` record).

### Paper Trading Sequencing

This sequence is a strict dependency order — each step requires the prior step to be approved and accepted before starting, not merely started:

1. **PT-0001 — Manual Paper Trading Sandbox** (complete, merged `05d0f31`) — the ledger/persistence/accounting foundation and a minimal manual UI.
2. **PT-0002A + PT-0002B — Application-Wide Portfolio Mode** (complete, merged `ce28842` / `ee26423`) — LIVE/PAPER as a first-class, application-wide context, gated on `/dashboard` and `/portfolio` (six other surfaces remain ungated — see above).
3. Separately approved paper-action integration into the rest of the product (e.g. taking a paper action directly from Portfolio Intelligence recommendations, the Daily Briefing, or the Opportunity Engine) — **not yet scoped, not yet a ticket.**
4. **TE-0010 — Autopilot Paper Mode** — only after manual paper mode is proven out. Autopilot activation is not implied or accelerated by PT-0001 or PT-0002A/B.

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

1. Opportunity Engine — Where should my next dollar go? (`lib/opportunity-engine`, OE-0001 foundation complete and merged; activated on `/screener` by OE-0002A — real ranked recommendations now render there. `/dashboard`'s Best Opportunity card remains on a hardcoded empty feed pending OE-0002B)
2. Portfolio Engine — What should I do with what I already own? (`lib/portfolio-intelligence`, PI-0001 + PI-0002 + PI-0003 complete; DT-0001 added a deterministic explanation layer on top)
3. Risk Engine — What could hurt me?
4. Income Engine — Am I producing enough recurring income? (`app/engine/page.tsx` — SPX/SPY/Wheel capital-allocation dashboard; not yet unified with the Decision Engine or Opportunity Engine)
5. Execution Engine — What do I actually need to do today?

## Working Model

- Paul: Product Owner
- Quinn: Chief Architect
- Dean: Lead Engineer / Implementation Lead
- Vercel: authoritative build validation after push

*(Historical note: earlier revisions of this document, and implementation reports predating 2026-07-24, refer to "Dean: Product Owner / Trader," "ChatGPT: Chief Architect / Reviewer," and "Claude/Gemini: Implementation Engineer." Those labels describe the same functional roles under different working names, formalized as the TradeEdge Engineering Operating Model on 2026-07-24; no responsibilities changed.)*
