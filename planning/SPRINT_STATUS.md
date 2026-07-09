# TradeEdge Autopilot — Sprint Status

**Branch:** `main`  
**Scope:** Background Screener + Autopilot Foundation  
**Last Updated:** 2026-07-09  
**Current Phase:** TE-0001 / TE-0005A stabilization  
**Next Objective:** Finish Cancel Scan, refresh/reconnect behavior, then move to Portfolio Intelligence

## Current Development Rule

Autopilot must learn to make explainable, portfolio-aware recommendations before it is allowed to create paper trades.

**No paper execution until the Decision Engine produces ranked recommendations with complete reasoning.**

For the current screener sprint, keep TastyTrade scan execution browser-owned/client-authenticated. Do not reintroduce Vercel server-side TastyTrade scan execution until server auth is explicitly solved.

## Definition of Done

A sprint is not complete until all required items are true:

- [x] Code written
- [x] Documentation updated
- [x] Changes committed and pushed
- [x] Vercel build passes
- [x] Sprint review completed
- [ ] Endpoint smoke tests pass when network access allows

## Active Sprint — Background Ranked Screener Stabilization

| Item | Status | Notes |
|---|---:|---|
| Ranked scan works on Screener page | ✅ | Restored stable client TaskManager path after server worker 401 failure. |
| Scan status survives in-app navigation | ✅ | Root-level task mirror mounted in app providers. |
| Duplicate completion popups removed | ✅ | Generic TaskStatusBar removed from global shell. |
| Completed cards do not resurrect after hard reload | ✅ | Non-running cards are not restored from localStorage. |
| Open Results behavior | ✅ | Hidden when already on target results view. |
| Earnings/follow-up badge polish | ✅ | DTE pill hidden; scheduled badges nowrap. |
| Cancel Scan | ⬜ | Next implementation target; see ADR-0003. |
| Refresh/reconnect while running | ⬜ | Decide reconnect vs mark stale/stopped. |
| Regression test | ⬜ | Test navigation, completion, reload, cancel. |

## Sprint Tracker

| Sprint | Name | Status | Build | Deploy | Smoke Test | Review |
|---|---|---:|---:|---:|---:|---:|
| 1A | Core Infrastructure | Completed ✅ | ✅ | ✅ | Deferred | ✅ |
| 1B | Framework | Completed ✅ | ✅ | ✅ | Deferred | ✅ |
| TE-0001 / TE-0005A | Background Ranked Screener Stabilization | Active | ⬜ | ⬜ | ⬜ | ⬜ |
| 2 | Decision Engine | Next | ⬜ | ⬜ | ⬜ | ⬜ |
| 3 | Paper Execution Engine | Not Started | ⬜ | ⬜ | ⬜ | ⬜ |
| 4 | Position Management | Not Started | ⬜ | ⬜ | ⬜ | ⬜ |
| 5 | Candidate Discovery | Not Started | ⬜ | ⬜ | ⬜ | ⬜ |
| 6 | Scheduler | Not Started | ⬜ | ⬜ | ⬜ | ⬜ |
| 7 | Dashboard | Not Started | ⬜ | ⬜ | ⬜ | ⬜ |
| 8 | Configuration | Not Started | ⬜ | ⬜ | ⬜ | ⬜ |
| 9 | Analytics | Not Started | ⬜ | ⬜ | ⬜ | ⬜ |
| 10 | Paper Beta | Not Started | ⬜ | ⬜ | ⬜ | ⬜ |

## Build History

| Sprint | Build Result | Notes |
|---|---:|---|
| 1A | ✅ Passed | Core infrastructure compiled in Vercel. |
| 1B | ✅ Passed | Framework build passed after TypeScript date-guard fix. |
| TE-0001 / TE-0005A | ⬜ | Await latest Vercel confirmation after handoff doc updates. |
| 2 | ⬜ | Pending. |
| 3 | ⬜ | Pending. |
| 4 | ⬜ | Pending. |
| 5 | ⬜ | Pending. |
| 6 | ⬜ | Pending. |
| 7 | ⬜ | Pending. |
| 8 | ⬜ | Pending. |
| 9 | ⬜ | Pending. |
| 10 | ⬜ | Pending. |

## Milestones

### ✅ Milestone A — Framework Complete

Completed:

- Core infrastructure
- Redis persistence
- API framework
- Dashboard shell
- Decision Confidence framework
- Opportunity Score framework
- Net Edge utility
- Dry-run runner
- Telemetry
- Run locking

### 🟡 TE-0001 / TE-0005A — Background Ranked Screener Stabilization

Goal: Ranked scan behaves like an app-level workflow rather than page-local UI.

Completed:

- Stable ranked scan path restored.
- Global progress/completion card works across in-app navigation.
- Duplicate notifications removed.
- Stale completed cards no longer restore on hard refresh.
- AI model fallback and centralized model defaults added.
- Screener badge polish applied.

Remaining:

- Cancel Scan.
- Refresh/reconnect behavior.
- Regression testing.

### ⬜ Milestone B — Decision Engine

Goal: Autopilot can think.

Output: ranked recommendations with complete acceptance/rejection reasoning.

Constraint: no paper trades.

### ⬜ Milestone C — Paper Trading

Goal: Autopilot can execute simulated trades.

### ⬜ Milestone D — Position Management

Goal: Autopilot can autonomously manage paper positions.

### ⬜ Milestone E — Paper Beta

Goal: entire paper-trading lifecycle validated.

### ⬜ Milestone F — Live Readiness Review

Goal: independent review confirms readiness for live-mode implementation. No live trading work starts before this review.

---

# Sprint Reviews

## Sprint 1A — Core Infrastructure Review

**Result:** Completed. Build passed in Vercel. Endpoint smoke tests remain deferred because preview access is blocked by network restrictions.

**Built:**

- Autopilot planning trackers: `SPRINT_STATUS.md` and `DECISIONS.md`
- Config defaults and validation module
- Redis persistence helpers
- Paper account store
- Decision log store
- Config audit store
- Server auth helper
- Safe infrastructure API routes for health, config, paper account, decisions, state, and status

**Safety:**

- No live-order capability added.
- No candidate scanning added.
- No paper trade execution added.
- No position management added.

## Sprint 1B — Framework Review

**Result:** Completed. Vercel build passed after a TypeScript narrowing fix in `lib/autopilot/scoring/confidence.ts`.

**Built:**

- Decision Confidence framework using the v1 four-factor model.
- Opportunity Score framework using edge, goal alignment, risk penalty, and posture multiplier.
- Net Edge utility using the approved theta/gamma formula.
- Redis-backed run-locking shell.
- Telemetry persistence and API route.
- Manual and cron dry-run endpoints.
- `/autopilot` dashboard shell.

**Safety:**

- Manual run is dry-run only.
- Cron run is dry-run only and requires secret authorization.
- No candidate scanning was added.
- No paper trades can be created.
- No live-order path was added.

**Known Follow-Up:**

- Endpoint smoke tests remain deferred until preview/local access is available.
- Sprint 2 must produce recommendations only; no paper execution.
