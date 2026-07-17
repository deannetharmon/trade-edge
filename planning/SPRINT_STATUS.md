# TradeEdge — Sprint Status

**Status:** Active operational source of truth  
**Last Updated:** 2026-07-17  
**Primary Branch:** `main`  
**Long-Lived Development Branch:** `feature/autopilot`

## Current State

Portfolio Intelligence implementation through PI-0013 is complete and merged into `main`.

There is no active implementation sprint.

The next sprint has not been approved. Before new implementation begins, the Product Owner must review real-world Portfolio Review and Daily Briefing behavior, unresolved follow-ups, and the roadmap, then recommend one frozen sprint.

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

No live execution work may begin before paper execution, autonomous paper management, paper beta validation, and an explicit live-readiness review are complete.

For TastyTrade scans, execution remains browser-owned and client-authenticated. Do not reintroduce Vercel server-side TastyTrade scan execution until server authentication is explicitly solved.

## Repository State

Verified 2026-07-17:

- Local branches: `main`, `feature/autopilot`
- Remote branches: `origin/main`, `origin/feature/autopilot`
- `main` synchronized with `origin/main`
- `feature/autopilot` synchronized with `origin/feature/autopilot`
- Working tree clean
- No stale backup branches
- No stale completed feature branches

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

PI-0012A and PI-0013 were merged to `main` in commit `a90f8f1` (`merge: portfolio intelligence`).

## Validation Baseline

The most recently documented Portfolio Intelligence baseline before PI-0012A/PI-0013 was:

- 398 tests passing repo-wide
- `tsc --noEmit` clean
- Production build attempts subject to the established five-minute environment limit

PI-0012A and PI-0013 were implementation-reviewed and merged. Real-position, multi-session acceptance validation of the combined Portfolio Review and Daily Briefing workflow remains pending.

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

Do not start another feature merely because PI-0013 is merged.

The Product Owner must first determine whether the highest-value next sprint is:

1. Portfolio Intelligence stabilization and acceptance fixes;
2. an unresolved foundational follow-up;
3. Paper Execution preparation;
4. another roadmap capability with greater immediate trader value.

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