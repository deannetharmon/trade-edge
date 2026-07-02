# TradeEdge Autopilot — Release Plan v1.0

**Scope:** Paper Mode v1.0  
**Target Branch:** `feature/autopilot-paper-mode`  
**Status:** Implementation Plan  
**Purpose:** Track sprint-by-sprint delivery of the TradeEdge Autopilot feature.

---

## Guiding Principles

Autopilot will be built incrementally. Each sprint must be:

- Buildable
- Deployable
- Reviewable
- Testable
- Rollback-safe
- Paper-mode only until explicitly promoted in a later specification

No sprint should introduce live-trading behavior.

---

# Sprint 1A — Core Infrastructure

## Goal

Create the Autopilot backend foundation with no UI, no cron, no candidate scanning, and no trading logic.

## Deliverables

- `lib/autopilot/` folder structure
- Core TypeScript models
- Autopilot config types
- Default config
- Config validation / sanitization
- Redis persistence helpers
- Paper account model
- Paper position model
- Decision log model
- Config audit log model
- Health-check endpoint

## Exit Criteria

- App builds cleanly
- Redis persistence is verified
- Default config can be loaded
- Config can be saved and reloaded
- Paper account can initialize
- Decision log entries can persist
- No UI yet
- No cron yet
- No paper trades yet

## Smoke Tests

- Start the app locally
- Call the health-check endpoint
- Confirm config defaults return correctly
- Confirm Redis read/write succeeds
- Confirm no live trading route exists

## Suggested Commit Message

```bash
git commit -m "feat(autopilot): add paper-mode core infrastructure"
```

---

# Sprint 1B — Framework

## Goal

Add the non-trading framework around the core infrastructure.

## Deliverables

- Opportunity Score engine shell
- Decision Confidence engine
- Net Edge utility
- API route shells
- Dashboard shell
- Cron endpoint shell
- Run-locking shell
- Telemetry scaffolding
- Manual run placeholder

## Exit Criteria

- `/autopilot` page loads
- API routes respond
- Cron endpoint responds safely
- Run lock can be acquired/released
- Decision Confidence can be calculated
- Net Edge can be calculated
- Opportunity Score returns deterministic placeholder output
- No trades are created

## Smoke Tests

- Load `/autopilot`
- Confirm dashboard shell renders
- Confirm manual run returns "not implemented" or dry-run response
- Confirm cron endpoint does not create trades
- Confirm kill switch state is visible

## Suggested Commit Message

```bash
git commit -m "feat(autopilot): add framework shell and scoring utilities"
```

---

# Architecture Review 1

Occurs after Sprint 1B.

## Questions

- Is the folder structure clean?
- Are types isolated from UI?
- Is Redis access centralized?
- Is config fully externalized?
- Are audit logs complete enough?
- Is anything already becoming duplicated?

## Exit Criteria

- No major refactor needed before building trading logic

---

# Sprint 2 — Scoring and Risk Engine

## Goal

Build the decision brain before allowing entries.

## Deliverables

- Full Opportunity Score implementation
- Full Decision Confidence implementation
- Regime-aware delta bands
- Net Edge calculation
- Per-trade max-loss gate
- Buying-power utilization gate
- Single-ticker concentration gate
- Sector concentration gate
- Daily entry limit
- Weekly entry limit
- Drawdown circuit breaker
- Macro-event gate
- Liquidity-stress gate
- Correlation gate placeholder

## Exit Criteria

- Candidate objects can be scored
- Candidates can be approved, rejected, or suppressed
- Every rejection creates a decision-log entry
- No paper trades are executed yet

## Smoke Tests

- Feed mock candidates into scoring engine
- Confirm high-quality candidates rank above poor candidates
- Confirm candidates below confidence threshold are suppressed
- Confirm over-sized trades are rejected
- Confirm drawdown pause blocks new entries

## Suggested Commit Message

```bash
git commit -m "feat(autopilot): add scoring and portfolio risk gates"
```

---

# Sprint 3 — Candidate Engine

## Goal

Discover, evaluate, and rank paper-trade candidates.

## Deliverables

- Candidate discovery pipeline
- BPS candidate evaluator
- BCS candidate evaluator
- IC candidate evaluator
- CSP candidate evaluator
- CC candidate evaluator
- Strategy-specific entry validation
- Candidate ranking
- Candidate queue API
- Candidate queue UI
- Rejection reason display

## Exit Criteria

- Autopilot can scan candidates
- Candidates are ranked by score
- UI shows approved and rejected candidates
- Still no paper trades are executed

## Smoke Tests

- Scan watchlist
- Confirm candidates appear in UI
- Confirm rejected candidates include reasons
- Confirm PMCC is not included in v1 candidate generation
- Confirm no live order path exists

## Suggested Commit Message

```bash
git commit -m "feat(autopilot): add candidate discovery and ranking"
```

---

# Sprint 4 — Paper Execution Engine

## Goal

Allow paper-only position entries.

## Deliverables

- Paper fill simulator
- Paper trade creation
- Position sizing
- Max-loss enforcement
- Open paper position storage
- Paper account balance update
- Entry decision logs
- Manual "Run Autopilot" button
- Paper-mode-only safety lock

## Exit Criteria

- Autopilot can create paper positions
- No live order path exists
- Every paper fill has a complete audit trail
- Position sizing respects all gates

## Smoke Tests

- Run Autopilot manually
- Confirm paper position is created
- Confirm paper account balance updates
- Confirm audit trail includes config snapshot
- Confirm rejected trades do not create positions

## Suggested Commit Message

```bash
git commit -m "feat(autopilot): add paper execution engine"
```

---

# Sprint 5 — Position Management Engine

## Goal

Manage open paper positions.

## Deliverables

- BPS management
- BCS management
- IC management
- CSP assignment-aware management
- CC short-call management
- 50% profit target logic
- 21-DTE close logic
- Short-dated entry handling
- Net Edge fade logic
- CC goal-mode roll logic
- Thesis-break escalation handling
- Unlock Shares action
- Management decision logs

## Exit Criteria

- Open positions are evaluated every run
- Existing positions can be closed or rolled in paper mode
- CSPs are not incorrectly forced closed at 21 DTE
- CC shares are never auto-sold except assignment
- Unlock Shares closes only the short call

## Smoke Tests

- Create mock paper positions
- Trigger 50% profit rule
- Trigger 21-DTE logic
- Trigger CSP assignment-acceptable path
- Trigger CC Unlock Shares
- Confirm every action is logged

## Suggested Commit Message

```bash
git commit -m "feat(autopilot): add paper position management"
```

---

# Sprint 6 — Scheduler and Automation

## Goal

Make paper-mode Autopilot run automatically.

## Deliverables

- Vercel Cron schedule
- Scheduled run endpoint
- Run locking
- Duplicate-run prevention
- Kill switch enforcement
- Run history
- Last-run display
- Next-run display
- Error logging
- Recovery behavior after failed run

## Exit Criteria

- Cron runs safely
- Overlapping runs are blocked
- Kill switch stops all activity
- Failed runs are logged without corrupting state

## Smoke Tests

- Call cron endpoint manually
- Confirm lock prevents duplicate run
- Enable kill switch and confirm run exits
- Simulate failed run and confirm error log
- Confirm state remains intact

## Suggested Commit Message

```bash
git commit -m "feat(autopilot): add scheduled paper-mode runner"
```

---

# Architecture Review 2

Occurs after Sprint 6.

## Questions

- Is the run loop deterministic?
- Are logs sufficient to replay decisions?
- Is scheduler state isolated from trading logic?
- Can a failed run corrupt paper state?
- Is the kill switch checked early enough?

## Exit Criteria

- Safe to build full user dashboard

---

# Sprint 7 — Autopilot Dashboard

## Goal

Make the feature usable and transparent.

## Deliverables

- Autopilot overview page
- Paper account summary
- Equity curve
- Open paper positions
- Closed paper positions
- Candidate queue
- Decision history
- Rule rejection explanations
- Opportunity Score display
- Decision Confidence display
- Portfolio risk status
- Kill switch
- Unlock Shares button
- Manual run button

## Exit Criteria

- User can understand what Autopilot did and why
- User can stop Autopilot instantly
- User can manually run Autopilot
- User can inspect every decision

## Smoke Tests

- Open dashboard
- View current paper account state
- View latest run
- View candidate queue
- Toggle kill switch
- Confirm Unlock Shares button appears only for active CC positions

## Suggested Commit Message

```bash
git commit -m "feat(autopilot): add dashboard and decision history"
```

---

# Sprint 8 — Configuration UI

## Goal

Make thresholds editable without redeploying.

## Deliverables

- Config editor
- Per-strategy goal selector
- Portfolio posture selector
- Threshold controls
- Config save
- Config reset
- Config change log
- Validation errors
- Read-only display of non-overridable rules

## Exit Criteria

- All spec thresholds are editable
- Invalid values are blocked
- Config changes are logged
- CC stock-management mechanism is not editable as a simple threshold

## Smoke Tests

- Change a threshold
- Save config
- Reload page
- Confirm value persists
- Try invalid value
- Confirm validation blocks save
- Confirm audit log records old/new values

## Suggested Commit Message

```bash
git commit -m "feat(autopilot): add configuration editor"
```

---

# Sprint 9 — Telemetry and Analytics

## Goal

Make paper results measurable.

## Deliverables

- Win rate
- Profit factor
- Expectancy
- Average winner
- Average loser
- Max drawdown
- Strategy-level P&L
- Regime-level P&L
- Decision Confidence outcome tracking
- Opportunity Score outcome tracking
- Rejection frequency tracking
- Config-change impact tracking

## Exit Criteria

- We can evaluate whether Autopilot is improving
- We can identify which rules are too strict or too loose
- We can tune from data instead of opinion

## Smoke Tests

- View analytics page
- Confirm metrics calculate from closed positions
- Confirm zero-data states render cleanly
- Confirm strategy filters work
- Confirm confidence/score buckets display outcomes

## Suggested Commit Message

```bash
git commit -m "feat(autopilot): add paper trading analytics"
```

---

# Sprint 10 — Hardening and Paper Beta

## Goal

Prepare for daily paper-mode operation.

## Deliverables

- Edge-case cleanup
- Empty-state handling
- API error handling
- Redis failure handling
- Market-closed behavior
- Stale quote behavior
- Bad data handling
- Regression testing
- Build verification
- UX polish

## Exit Criteria

- Feature is safe for daily paper-mode use
- No known state-corruption bugs
- No accidental live-trading path
- Ready to merge into `main`

## Smoke Tests

- Run full build
- Test market-closed behavior
- Test Redis failure handling
- Test stale data handling
- Test empty watchlist
- Test kill switch
- Test manual run
- Test cron run
- Test dashboard reload

## Suggested Commit Message

```bash
git commit -m "chore(autopilot): harden paper-mode beta"
```

---

# Milestones

## Milestone A — Foundation Complete

**Includes:** Sprint 1A, Sprint 1B, Sprint 2

Autopilot exists, scores decisions, and blocks unsafe candidates.

## Milestone B — Paper Entry Complete

**Includes:** Sprint 3, Sprint 4

Autopilot can discover and open paper trades.

## Milestone C — Paper Management Complete

**Includes:** Sprint 5, Sprint 6

Autopilot can manage open paper positions on schedule.

## Milestone D — User-Ready Dashboard

**Includes:** Sprint 7, Sprint 8

Autopilot is usable, observable, and configurable.

## Milestone E — Paper Beta

**Includes:** Sprint 9, Sprint 10

Autopilot is measurable, stable, and ready for daily paper-mode use.

---

# Merge Standard

The `feature/autopilot-paper-mode` branch should merge into `main` only after:

- Sprint 10 exit criteria pass
- Vercel build succeeds
- Paper-mode safety lock is confirmed
- No live-order capability exists
- Dashboard works
- Config editor works
- Cron runs safely
- Decision logging is complete
- Analytics render cleanly
- Manual smoke tests pass

---

# Documentation Standard

The repository should maintain these documents under `/planning`:

```text
planning/
├── AUTOPILOT_SPEC_v1.0.md
├── AUTOPILOT_RELEASE_PLAN_v1.0.md
├── AUTOPILOT_TECHNICAL_DESIGN.md
└── AUTOPILOT_CHANGELOG.md
```

The release plan tracks delivery.  
The specification defines required behavior.  
The technical design defines implementation details.  
The changelog records material changes after v1.0.

