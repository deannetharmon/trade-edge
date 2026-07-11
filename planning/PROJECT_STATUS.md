# TradeEdge Autopilot — Project Status

**Branch:** `feature/autopilot-paper-mode`  
**Scope:** Paper Mode v1.0  
**Last Updated:** 2026-07-02

## Executive Summary

Autopilot has completed its framework milestone. The repository now contains the paper-mode foundation, configuration/persistence layer, audit logging, scoring framework, telemetry, run locking, dry-run endpoints, and dashboard shell.

The next milestone is the Decision Engine: Autopilot must produce ranked, explainable recommendations before any paper execution is enabled.

## Current Phase

**Milestone A — Framework Complete ✅**

Completed:

- Sprint 1A — Core Infrastructure ✅
- Sprint 1B — Framework ✅

## Next Objective

**Milestone B — Decision Engine**

Primary output:

- Ranked recommendations
- Explicit acceptance/rejection reasoning
- Portfolio-aware risk gate results
- Decision logs for every candidate

Constraint:

- No paper trades
- No live trades

## Current Sprint

**Sprint 2 — Decision Engine**

Status: Not started.

## Last Successful Build

**Sprint 1B:** Vercel build passed after TypeScript date-guard fix in `lib/autopilot/scoring/confidence.ts`.

## Safety Status

| Area | Status |
|---|---:|
| Live order path | None ✅ |
| Paper execution | Disabled ✅ |
| Candidate scanning | Disabled until Sprint 2 ⬜ |
| Dry-run route | Enabled ✅ |
| Cron route | Dry-run only ✅ |
| Run locking | Redis-backed ✅ |
| Telemetry | Enabled ✅ |
| Decision logging | Enabled ✅ |

## Key Risks

1. **Endpoint smoke testing is limited** because preview access is blocked by network restrictions.
2. **Vercel is the build source of truth** because local npm is unavailable.
3. **Sprint 2 must avoid execution creep** — recommendations only, no paper positions.
4. **Risk gates must produce explicit reasons**, otherwise Autopilot will be hard to debug.

## Recent Accomplishments

- Planning docs established.
- Sprint status tracker created.
- Architecture decisions documented.
- Core Autopilot types created.
- Config and persistence layer added.
- Decision Confidence framework added.
- Opportunity Score framework added.
- Net Edge utility added.
- Redis run lock added.
- Telemetry store added.
- Dry-run runner added.
- `/autopilot` dashboard shell added.
- Vercel build passed for Sprint 1A and Sprint 1B.

## Upcoming Work

Sprint 2 will build the Decision Engine:

- Portfolio state builder
- Candidate evaluation pipeline
- Risk gate evaluation
- Scoring integration
- Ranked recommendations
- Rejection reasons
- Recommendation API
- Recommendation display shell

No paper execution is allowed in Sprint 2.
