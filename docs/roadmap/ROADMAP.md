# Trade Edge Roadmap

## Current Branch

`feature/portfolio-intelligence`

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

## Completed Trader Intelligence

- TE-0006A — Portfolio Health Scoring Framework (consolidated into `lib/portfolio-intelligence` in PI-0002)
- TE-0006B — Portfolio Recommendation Rules (consolidated into `lib/portfolio-intelligence` in PI-0002, now produces canonical `PortfolioObjective[]`)
- Sprint 2 — Decision Engine (`lib/decision-engine`, `lib/autopilot/decision`) — merged to `main`, live in production
- Sprint 3, PI-0001 — Portfolio Objective Engine (`lib/portfolio-intelligence`) — first slice, locally verified, pending Vercel confirmation
- Sprint 3, PI-0002 — Portfolio Engine Consolidation — TE-0006A/B moved out of `features/portfolio/` into the canonical model, `app/portfolio/page.tsx` now a consumer, stable rule IDs introduced
- Sprint 3, PI-0003 — Canonical Portfolio Priority Engine — risk policy separation, 15 fine-grained rule IDs, TE-0006C (Daily Priority List) consolidated into the canonical `prioritizePortfolioObjectives()`, `evaluatePortfolioObjectives()` given its first production consumer
- Sprint 3, PI-0003.5 — Real Financial Data Wiring — `DEPLOY_IDLE_CASH`, `REDUCE_CONCENTRATION`, and `PRESERVE_BUYING_POWER`'s utilization branch now fire from real account balances via a new single normalization point, locally verified, pending Vercel confirmation

Note: `evaluatePortfolioObjectives()`'s output is wired into the Portfolio page's state but not yet rendered anywhere. Portfolio-level financial aggregates (net liquidity, buying power, drawdown, concentration, income) aren't yet read from the Balances tab, so those specific objective rules don't fire from production data yet. See `planning/SPRINT3_PI0003_PLAN.md` "Later items".

## Current Planning Focus

### Phase 3 — Trader Intelligence Master Specification

See:

`docs/specifications/TradeEdge-Phase3-Master-Specification.md`

Phase 3 shifts the product from infrastructure toward trader-facing intelligence. Sprint 3's Portfolio Intelligence layer (`lib/portfolio-intelligence`) is the current implementation of this shift's portfolio-level reasoning.

## Near-Term Roadmap

1. Portfolio Intelligence — next slice(s) beyond PI-0003 (see "Later items" in `planning/SPRINT3_PI0003_PLAN.md`, `planning/SPRINT3_PI0002_PLAN.md`, and `planning/SPRINT3_PORTFOLIO_INTELLIGENCE_PLAN.md`)
2. TE-0006C — Daily Priority List
3. TE-0006D — Position Advisor Cards
4. TE-0006E — Recommendation Explanation Panel
5. TE-0007 — Opportunity Engine Foundation
6. TE-0008 — Capital Allocation / Wheel Preference Engine
7. TE-0009 — Income Engine Foundation
8. TE-0010 — Autopilot Paper Mode

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

1. Opportunity Engine — Where should my next dollar go?
2. Portfolio Engine — What should I do with what I already own? (`lib/portfolio-intelligence`, PI-0001 + PI-0002 + PI-0003 complete)
3. Risk Engine — What could hurt me?
4. Income Engine — Am I producing enough recurring income?
5. Execution Engine — What do I actually need to do today?

## Working Model

- Dean: Product Owner / Trader
- ChatGPT: Chief Architect / Reviewer
- Claude/Gemini: Implementation Engineer
- Vercel: authoritative build validation after push
