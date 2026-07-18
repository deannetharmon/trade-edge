# Trade Edge Roadmap

## Current Branch

`main` is the primary branch. `feature/autopilot` is the long-lived Autopilot development branch. `feature/opportunity-engine-foundation` is an active short-lived sprint branch (OE-0001, implemented, awaiting Product Owner review — not yet merged).

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

**TE-0007 — Opportunity Engine Foundation** is implemented via **OE-0001** on `feature/opportunity-engine-foundation`, awaiting Product Owner review (not yet merged). It adds `lib/opportunity-engine/`, a deterministic ranking layer over already-computed Decision Engine evaluations, one real connected candidate adapter (`DecisionAnalysis → OpportunityCandidate`), and a read-only "Best Opportunities" tab in the Income Engine — currently rendering an honest empty state pending a live candidate feed. See `docs/design/OE-0001-Opportunity-Engine-Foundation.md` and `docs/reviews/OE-0001-Implementation-Report.md`.

Note: some of the items above (PI-0004D, PI-0005, PI-0008B) are not currently reflected in `planning/SPRINT_STATUS.md`'s Completed Capability Tracker table. They are included here on the basis of their own implementation specs/reports in `planning/` and `docs/reviews/`; reconciling that tracker table is a documentation follow-up, not part of the OE-0001 sprint.

## Current Planning Focus

### Phase 3 — Trader Intelligence Master Specification

See:

`docs/specifications/TradeEdge-Phase3-Master-Specification.md`

Phase 3 shifts the product from infrastructure toward trader-facing intelligence. Sprint 3's Portfolio Intelligence layer (`lib/portfolio-intelligence`) and OE-0001's Opportunity Engine layer (`lib/opportunity-engine`) are the current implementations of this shift's portfolio- and opportunity-level reasoning.

## Near-Term Roadmap

1. Product Owner review and disposition of OE-0001 (merge decision, or corrective follow-up)
2. Give a real page a live `DecisionAnalysis[]` feed (via the existing `POST /api/autopilot/recommendations` route) so the Best Opportunities panel can render real rankings — surfaced as a backlog item by OE-0001, not yet an approved sprint
3. Portfolio Intelligence real-world acceptance validation (see `planning/SPRINT_STATUS.md` "Known Follow-Ups")
4. TE-0008 — Capital Allocation / Wheel Preference Engine
5. TE-0009 — Income Engine Foundation
6. TE-0010 — Autopilot Paper Mode

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

1. Opportunity Engine — Where should my next dollar go? (`lib/opportunity-engine`, OE-0001 foundation implemented, pending review)
2. Portfolio Engine — What should I do with what I already own? (`lib/portfolio-intelligence`, PI-0001 + PI-0002 + PI-0003 complete)
3. Risk Engine — What could hurt me?
4. Income Engine — Am I producing enough recurring income? (`app/engine/page.tsx` — SPX/SPY/Wheel capital-allocation dashboard; not yet unified with the Decision Engine or Opportunity Engine)
5. Execution Engine — What do I actually need to do today?

## Working Model

- Dean: Product Owner / Trader
- ChatGPT: Chief Architect / Reviewer
- Claude/Gemini: Implementation Engineer
- Vercel: authoritative build validation after push
