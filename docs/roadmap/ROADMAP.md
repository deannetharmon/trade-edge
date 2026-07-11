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

- TE-0006A — Portfolio Health Scoring Framework
- TE-0006B — Portfolio Recommendation Rules
- Sprint 2 — Decision Engine (`lib/decision-engine`, `lib/autopilot/decision`) — merged to `main`, live in production
- Sprint 3, PI-0001 — Portfolio Objective Engine (`lib/portfolio-intelligence`) — first slice, locally verified, pending Vercel confirmation

Note: TE-0006A/B are page-local logic inside `app/portfolio/page.tsx` and are not yet reconciled with the newer `lib/portfolio-intelligence` canonical model. See `planning/SPRINT3_PORTFOLIO_INTELLIGENCE_PLAN.md` for the open reconciliation item.

## Current Planning Focus

### Phase 3 — Trader Intelligence Master Specification

See:

`docs/specifications/TradeEdge-Phase3-Master-Specification.md`

Phase 3 shifts the product from infrastructure toward trader-facing intelligence. Sprint 3's Portfolio Intelligence layer (`lib/portfolio-intelligence`) is the current implementation of this shift's portfolio-level reasoning.

## Near-Term Roadmap

1. Portfolio Intelligence — next slice(s) beyond PI-0001 (see "Later Sprint 3 items" in `planning/SPRINT3_PORTFOLIO_INTELLIGENCE_PLAN.md`)
2. TE-0006C — Daily Priority List
3. TE-0006D — Position Advisor Cards
4. TE-0006E — Recommendation Explanation Panel
5. TE-0007 — Opportunity Engine Foundation
6. TE-0008 — Capital Allocation / Wheel Preference Engine
7. TE-0009 — Income Engine Foundation
8. TE-0010 — Autopilot Paper Mode

## Core Product Engines

1. Opportunity Engine — Where should my next dollar go?
2. Portfolio Engine — What should I do with what I already own? (`lib/portfolio-intelligence`, PI-0001 in progress)
3. Risk Engine — What could hurt me?
4. Income Engine — Am I producing enough recurring income?
5. Execution Engine — What do I actually need to do today?

## Working Model

- Dean: Product Owner / Trader
- ChatGPT: Chief Architect / Reviewer
- Claude/Gemini: Implementation Engineer
- Vercel: authoritative build validation after push
