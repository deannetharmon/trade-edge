# TradeEdge Autopilot --- Release Plan (Paper Mode v1.0)

## Overview

This document defines the implementation roadmap for the **TradeEdge
Autopilot** paper-mode feature. Each sprint is independently deployable,
reviewable, and testable.

------------------------------------------------------------------------

# Sprint 1 --- Foundation

**Goal:** Create the Autopilot infrastructure without trading logic.

## Deliverables

-   `lib/autopilot` folder structure
-   Core TypeScript types
-   Default config
-   Config validation/sanitization
-   Redis persistence layer
-   Paper account model
-   Paper position model
-   Decision log model
-   Decision Confidence engine
-   Opportunity Score shell
-   Net Edge utility
-   API shell
-   Dashboard shell
-   Cron endpoint shell
-   Run locking shell

## Exit Criteria

-   App builds successfully
-   `/autopilot` page loads
-   Config can be read/written
-   Paper account initializes
-   Decision logs persist
-   Cron endpoint responds safely
-   No paper trades are created

------------------------------------------------------------------------

# Sprint 2 --- Scoring & Risk Engine

**Goal:** Build the decision brain.

## Deliverables

-   Opportunity Score implementation
-   Decision Confidence implementation
-   Regime-aware delta bands
-   Net Edge calculation
-   Per-trade max-loss gate
-   Buying-power utilization gate
-   Single-ticker concentration gate
-   Sector concentration gate
-   Daily/weekly entry limits
-   Drawdown circuit breaker
-   Macro-event gate
-   Liquidity-stress gate
-   Correlation gate placeholder

## Exit Criteria

-   Candidates are scored
-   Candidates are approved/rejected/suppressed
-   Every rejection is logged
-   No entries executed yet

------------------------------------------------------------------------

# Sprint 3 --- Candidate Engine

**Goal:** Discover and rank candidates.

## Deliverables

-   Candidate discovery
-   BPS evaluator
-   BCS evaluator
-   IC evaluator
-   CSP evaluator
-   CC evaluator
-   Entry validation
-   Candidate ranking
-   Candidate queue API
-   Candidate queue UI
-   Rejection explanations

## Exit Criteria

-   Candidates are scanned
-   Ranked by score
-   Displayed in UI
-   Still no paper trades

------------------------------------------------------------------------

# Sprint 4 --- Paper Execution Engine

**Goal:** Execute paper-only entries.

## Deliverables

-   Paper fill simulator
-   Paper trade creation
-   Position sizing
-   Max-loss enforcement
-   Open position persistence
-   Paper account updates
-   Entry decision logs
-   Manual "Run Autopilot" action
-   Paper-only safety lock

## Exit Criteria

-   Paper positions created
-   No live orders
-   Full audit trail
-   Risk gates enforced

------------------------------------------------------------------------

# Sprint 5 --- Position Management

**Goal:** Manage paper positions.

## Deliverables

-   BPS/BCS/IC management
-   50% profit targets
-   21 DTE handling
-   Net Edge management
-   CSP assignment-aware logic
-   CC management
-   Goal-mode roll logic
-   Thesis-break escalation
-   Unlock Shares
-   Management decision logs

## Exit Criteria

-   Existing positions managed automatically
-   Roll/close actions simulated
-   CSP handled correctly
-   CC never auto-sells shares except assignment

------------------------------------------------------------------------

# Sprint 6 --- Scheduler

**Goal:** Fully automate paper mode.

## Deliverables

-   Vercel Cron
-   Scheduled runner
-   Run locking
-   Duplicate-run prevention
-   Kill switch
-   Run history
-   Last/next run display
-   Error recovery

## Exit Criteria

-   Cron executes safely
-   No overlapping runs
-   Kill switch works
-   Failed runs logged

------------------------------------------------------------------------

# Sprint 7 --- Dashboard

**Goal:** Deliver the user experience.

## Deliverables

-   Dashboard
-   Paper account summary
-   Equity curve
-   Open positions
-   Closed positions
-   Candidate queue
-   Decision history
-   Opportunity Score
-   Decision Confidence
-   Risk status
-   Kill switch
-   Unlock Shares
-   Manual Run

## Exit Criteria

-   Decisions are transparent
-   User can inspect and control Autopilot

------------------------------------------------------------------------

# Sprint 8 --- Configuration

**Goal:** Make behavior configurable.

## Deliverables

-   Configuration editor
-   Strategy goal editor
-   Portfolio posture editor
-   Threshold controls
-   Save/reset
-   Config audit log
-   Validation
-   Non-editable strategy identity rules

## Exit Criteria

-   Thresholds editable without deployment
-   Invalid values rejected
-   Changes audited

------------------------------------------------------------------------

# Sprint 9 --- Analytics

**Goal:** Measure performance.

## Deliverables

-   Win rate
-   Profit factor
-   Expectancy
-   Average winner/loser
-   Drawdown
-   Strategy P&L
-   Regime analysis
-   Decision Confidence analytics
-   Opportunity Score analytics
-   Rule rejection metrics
-   Config impact metrics

## Exit Criteria

-   Paper performance measurable
-   Data-driven tuning possible

------------------------------------------------------------------------

# Sprint 10 --- Hardening & Paper Beta

**Goal:** Production-quality paper mode.

## Deliverables

-   Edge-case handling
-   API resilience
-   Redis failure handling
-   Market closed behavior
-   Stale quote handling
-   Regression testing
-   Build verification
-   UX polish

## Exit Criteria

-   Safe daily operation
-   No known state corruption
-   No live trading path
-   Ready for merge into `main`

------------------------------------------------------------------------

# Milestones

## Milestone A --- Foundation Complete

**Sprints 1--2**

Infrastructure, scoring, and risk engine complete.

## Milestone B --- Paper Entry Complete

**Sprints 3--4**

Paper trade entry operational.

## Milestone C --- Paper Management Complete

**Sprints 5--6**

Autonomous paper management operational.

## Milestone D --- User-Ready Dashboard

**Sprints 7--8**

Configurable, observable, and user-friendly.

## Milestone E --- Paper Beta

**Sprints 9--10**

Stable, measurable, and ready for merge.

------------------------------------------------------------------------

# Success Criteria

-   Deterministic execution
-   Complete audit trail
-   No live-order capability
-   Config-driven behavior
-   Incremental deployability
-   Production-quality architecture
