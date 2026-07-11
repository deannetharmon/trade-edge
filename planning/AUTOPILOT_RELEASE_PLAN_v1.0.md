# TradeEdge Autopilot — Release Plan v1.0

**Scope:** Paper Mode v1.0  
**Branch:** `feature/autopilot-paper-mode`  
**Current Phase:** Milestone A Complete ✅  
**Next Objective:** Milestone B — Decision Engine

## Overview

This document defines the implementation roadmap for the TradeEdge Autopilot paper-mode feature.

Each sprint must be independently deployable, reviewable, testable, and rollback-safe. No sprint may introduce live-trading behavior.

## Project Rule

Autopilot must learn to make high-quality, explainable, portfolio-aware decisions before it is allowed to create paper trades.

Therefore:

- Sprints 1A and 1B establish framework and controls.
- Sprint 2 produces ranked recommendations only.
- Sprint 3 is the first sprint allowed to create paper positions.
- Live trading remains out of scope for Paper Mode v1.0.

---

# Completed Sprints

## Sprint 1A — Core Infrastructure ✅

**Goal:** Create the Autopilot backend foundation with no UI behavior, no cron execution, no candidate scanning, and no trading logic.

### Delivered

- `lib/autopilot/` structure
- Core TypeScript models
- Config defaults and validation
- Redis persistence helpers
- Paper account store
- Decision log store
- Config audit store
- Health/status/state/config API routes

### Result

Vercel build passed.

### Safety

No live orders, no paper trades, no candidate scanning, no position management.

---

## Sprint 1B — Framework ✅

**Goal:** Add the non-trading framework around the Sprint 1A infrastructure.

### Delivered

- Decision Confidence framework
- Opportunity Score framework
- Net Edge utility
- Redis run-locking
- Telemetry persistence
- Framework dry-run runner
- Manual dry-run endpoint
- Cron dry-run endpoint
- Telemetry endpoint
- `/autopilot` dashboard shell

### Result

Vercel build passed after TypeScript date-guard fix.

### Safety

Manual and cron routes are dry-run only. No candidate scanning, no paper execution, no live order path.

---

# Sprint 2 — Decision Engine

**Goal:** Teach Autopilot to think before it can act.

Sprint 2 produces ranked recommendations with complete acceptance/rejection reasoning. It does not create paper positions.

## Deliverables

- Portfolio state builder
- Market state interface
- Watchlist/candidate input contract
- Candidate evaluation pipeline
- Opportunity Score integration
- Decision Confidence integration
- Net Edge integration
- Risk gate evaluation
- Buying-power gate evaluation
- Concentration gate evaluation
- Correlation gate placeholder or implementation
- Macro/liquidity/volatility gate integration
- Candidate rejection reasons
- Ranked recommendation output
- Decision log generation for accepted and rejected recommendations
- Recommendation API route
- Recommendation display shell on `/autopilot`

## Exit Criteria

- Autopilot can evaluate supplied/mock candidates.
- Every candidate receives a score, confidence value, and final recommendation status.
- Every rejected candidate includes explicit rule reasons.
- Recommendations are ranked.
- Decision logs capture accepted/rejected decisions.
- No paper trades are created.
- Vercel build passes.

## Smoke Tests

- Run recommendation endpoint with mock candidates.
- Confirm ranked recommendations return JSON.
- Confirm rejected candidates include rule names.
- Confirm over-sized candidate is rejected.
- Confirm low-confidence candidate is suppressed.
- Confirm no open paper positions are created.

---

# Sprint 3 — Paper Execution Engine

**Goal:** Convert approved recommendations into simulated paper positions.

## Deliverables

- Paper order creation
- Fill simulator
- Position sizing
- Max-loss enforcement
- Paper buying-power accounting
- Paper cash accounting
- Paper equity curve updates
- Paper P/L framework
- Entry decision logs
- Manual paper-run action
- Paper-mode-only safety lock

## Exit Criteria

- Paper positions can be created from approved recommendations.
- No live order path exists.
- Paper account state updates correctly.
- Every paper fill has full audit trail.
- Risk gates are enforced before paper execution.

---

# Sprint 4 — Position Management

**Goal:** Manage open paper positions.

## Deliverables

- BPS/BCS/IC management logic
- 50% profit target logic
- 21 DTE management
- Net Edge fade management
- CSP assignment-aware management
- CC short-call management
- CC goal-mode roll logic
- Thesis-break escalation handling
- Unlock Shares action
- Management decision logs

## Exit Criteria

- Open paper positions are evaluated every run.
- Existing positions can be closed or rolled in paper mode.
- CSPs are not incorrectly forced closed at 21 DTE.
- CC shares are never auto-sold except assignment.
- Unlock Shares closes only the short call.

---

# Sprint 5 — Candidate Discovery

**Goal:** Replace mock/supplied candidate input with real app-integrated discovery.

## Deliverables

- Screener/watchlist integration
- Strategy-specific filters
- Duplicate suppression
- Portfolio-aware candidate selection
- Existing position awareness
- Earnings-aware candidate suppression
- Sector/industry metadata integration
- Candidate queue UI

## Exit Criteria

- Autopilot can discover candidates from TradeEdge data.
- Candidates are ranked and explained.
- Duplicate or conflicting candidates are suppressed.
- Discovery still cannot bypass portfolio risk gates.

---

# Sprint 6 — Scheduler

**Goal:** Fully automate paper-mode evaluation safely.

## Deliverables

- Vercel Cron configuration
- Scheduled runner
- Run locking
- Duplicate-run prevention
- Kill switch enforcement
- Run history
- Last-run and next-run display
- Error logging
- Recovery behavior after failed run

## Exit Criteria

- Cron runs safely.
- Overlapping runs are blocked.
- Kill switch stops all activity.
- Failed runs are logged without corrupting state.

---

# Sprint 7 — Dashboard

**Goal:** Make Autopilot observable and usable.

## Deliverables

- Paper account summary
- Equity curve
- Open paper positions
- Closed paper positions
- Candidate queue
- Decision history
- Rejection explanations
- Opportunity Score display
- Decision Confidence display
- Portfolio risk status
- Manual run button
- Kill switch UI
- Unlock Shares button

## Exit Criteria

- User can understand what Autopilot did and why.
- User can stop Autopilot instantly.
- User can manually run Autopilot.
- User can inspect every decision.

---

# Sprint 8 — Configuration

**Goal:** Make thresholds editable without redeploying.

## Deliverables

- Config editor
- Strategy goal editor
- Portfolio posture editor
- Threshold controls
- Save/reset behavior
- Config audit log UI
- Validation errors
- Read-only display of non-overridable rules

## Exit Criteria

- All spec thresholds are editable.
- Invalid values are rejected.
- Config changes are logged.
- CC stock-management mechanism is not reduced to a simple editable threshold.

---

# Sprint 9 — Analytics

**Goal:** Make paper results measurable.

## Deliverables

- Win rate
- Profit factor
- Expectancy
- Average winner/loser
- Max drawdown
- Strategy-level P&L
- Regime-level P&L
- Decision Confidence outcome tracking
- Opportunity Score outcome tracking
- Rule rejection frequency tracking
- Config-change impact tracking

## Exit Criteria

- Paper performance is measurable.
- Rule tuning can be driven by data instead of opinion.

---

# Sprint 10 — Paper Beta

**Goal:** Prepare for daily paper-mode operation.

## Deliverables

- Edge-case handling
- Empty-state handling
- API error hardening
- Redis failure handling
- Market-closed behavior
- Stale quote behavior
- Bad data handling
- Regression testing
- Build verification
- UX polish
- Update TradeEdge help documentation for all Autopilot and Decision Engine workflows delivered in Sprints 2–9
- Add or revise user guidance for recommendations, confidence scores, rejection reasons, kill switch behavior, paper positions, position management, configuration, analytics, and known limitations
- Verify help links and contextual guidance from the relevant application screens

## Exit Criteria

- Feature is safe for daily paper-mode use.
- No known state-corruption bugs.
- No accidental live-trading path.
- Help documentation accurately reflects the implemented Paper Mode workflows and safety boundaries.
- Every major Autopilot screen has discoverable, current user guidance.
- Ready to merge into `main`.

---

# Milestones

## ✅ Milestone A — Framework Complete

Completed by Sprint 1A and Sprint 1B.

Includes:

- Core infrastructure
- Persistence
- API framework
- Dashboard shell
- Scoring framework
- Dry-run engine
- Telemetry
- Run locking

## ⬜ Milestone B — Decision Engine

Goal: Autopilot can think.

Output: ranked recommendation list with complete reasoning.

Constraint: no paper trades.

## ⬜ Milestone C — Paper Trading

Goal: Autopilot can execute simulated trades.

## ⬜ Milestone D — Position Management

Goal: Autopilot can autonomously manage paper positions.

## ⬜ Milestone E — Paper Beta

Goal: entire paper-trading lifecycle validated.

## ⬜ Milestone F — Live Readiness Review

Goal: independent review confirms readiness for live-mode implementation. No live trading work starts before this review.
