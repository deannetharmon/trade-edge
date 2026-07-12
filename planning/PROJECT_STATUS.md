# TradeEdge Autopilot — Project Status

**Branch:** `feature/portfolio-intelligence`  
**Scope:** Portfolio Intelligence (Sprint 3, PI-0002 — Portfolio Engine Consolidation)  
**Last Updated:** 2026-07-11

## Executive Summary

Autopilot has completed the Decision Engine milestone: `lib/decision-engine` (single-candidate reasoning) and `lib/autopilot/decision` (orchestration) are built, tested (107 tests), and merged to `main` — confirmed live in production, including an end-to-end kill switch verification. No paper or live execution exists anywhere in the codebase.

Sprint 3 has begun: Portfolio Intelligence answers a different question than the Decision Engine. Instead of "is this candidate a good trade?", it answers "given the entire portfolio, what deserves the trader's attention today?" The first slice, PI-0001 (Portfolio Objective Engine), is complete — a pure, deterministic evaluator that converts portfolio state into ranked, explainable `PortfolioObjective[]`. The second slice, PI-0002 (Portfolio Engine Consolidation), is also complete: the pre-existing TE-0006A (Portfolio Health) and TE-0006B (Portfolio Recommendation Rules) modules — which turned out to already be separately extracted into `features/portfolio/`, not inline in the page as originally assumed — are now consolidated into `lib/portfolio-intelligence`, with `app/portfolio/page.tsx` consuming the canonical engine directly and zero user-visible behavior change (verified by 23 new parity tests).

## Current Phase

**Milestone A — Framework Complete ✅**
**Milestone B — Decision Engine Complete ✅**

Completed:

- Sprint 1A — Core Infrastructure ✅
- Sprint 1B — Framework ✅
- TE-0001 / TE-0005A — Background Ranked Screener Stabilization ✅
- Sprint 2 — Decision Engine ✅ (merged to `main`, live in production)

## Next Objective

**Milestone B2 — Portfolio Intelligence**

Primary output:

- Ranked, explainable `PortfolioObjective[]` covering existing-position management, portfolio-level risk/construction, pending orders, and legitimate "wait" outcomes.
- Explainable prioritization (priority + urgency as independent dimensions, never one opaque score).
- Optional linking to an existing `DecisionAnalysis` where applicable.

Constraint:

- No paper trades
- No live trades
- No position mutation

## Current Sprint

**Sprint 3 (PI-0002) — Portfolio Engine Consolidation**

Status: Complete, locally verified. Vercel preview/production confirmation pending push. See `planning/SPRINT3_PI0002_PLAN.md` for full scope, including the design decisions made under judgment and what's explicitly deferred.

## Last Successful Build

**Sprint 3 (PI-0002), local:** 155 tests passing repo-wide (23 new), `tsc --noEmit` clean, `next build` clean including `/portfolio`. Vercel is still the authoritative build validator — this reflects local verification pending push confirmation.

**Sprint 2, production:** 107 tests passing, `tsc --noEmit` clean, confirmed live and working end-to-end on `options-screener-dun.vercel.app`.

## Safety Status

| Area | Status |
|---|---:|
| Live order path | None anywhere in the codebase ✅ |
| Paper execution | Disabled ✅ |
| Candidate scanning | Live (screener bridge), recommendation-only ✅ |
| Decision Engine | Complete, live in production ✅ |
| Portfolio Intelligence (PI-0001, PI-0002) | Complete, locally verified, not yet deployed ✅ |
| Kill switch | Enforced and UI-controllable, verified live ✅ |
| Dry-run route | Enabled ✅ |
| Cron route | Dry-run only ✅ |
| Run locking | Redis-backed ✅ |
| Telemetry | Enabled ✅ |
| Decision logging | Enabled ✅ |
| Audit logging | Enabled, includes kill-switch pause events ✅ |

## Key Risks

1. **Vercel is the build source of truth** because local npm is unavailable to the trader; every delivery in this project is locally verified first, then confirmed against a real Vercel build before being considered done.
2. **Sprint 3 must avoid execution creep** — recommendations only, no position mutation, matching the Sprint 2 discipline that already held.
3. **TE-0006A/B reconciliation is resolved for the core logic** — PI-0002 moved both into `lib/portfolio-intelligence` and consolidated TE-0006B into producing canonical `PortfolioObjective[]`. What remains: `features/portfolio/priorities/` (TE-0006C, Daily Priority List) still has its own separate ranking, not yet reconciled with `PortfolioObjective` ranking, and the portfolio-level batch evaluator (`evaluatePortfolioObjectives`) still has zero callers anywhere in the app. Both flagged as later items in `planning/SPRINT3_PI0002_PLAN.md`, not accidental gaps.
4. **`main`/production git-history sync must be actively maintained** — a prior gap where production was live-testing branch code with no corresponding `main` commit was found and closed (2026-07-11); future branches should merge to `main` before Vercel is treated as confirming anything durable.

## Recent Accomplishments

- Sprint 2 Decision Engine built, tested, and validated (93 → 107 tests across two closure rounds).
- Kill switch gap found and closed: was persisted/displayed but never enforced; now blocks recommendation generation before any candidate is evaluated.
- Per-candidate rationale gap found and closed: was three fixed sentences, now composed from each candidate's actual data.
- Observable duplicate-candidate tracking added (`DuplicateCandidateRecord`, exact count reconciliation).
- Iron Condor deterministic fixture added.
- Kill switch UI control shipped and verified end-to-end in production.
- A real UI bug (badge falsely showing "Active" on a failed status fetch) caught via screenshot and fixed same-day.
- `main`/production sync gap identified and resolved via a clean fast-forward merge.
- `feature/portfolio-intelligence` branch created from updated `main`.
- PI-0001 Portfolio Objective Engine built: canonical `PortfolioObjective` contract, ten-rule deterministic evaluator, explainable ranking, full PI-001–PI-010 test coverage plus safety tests.
- PI-0002 Portfolio Engine Consolidation built: TE-0006A moved verbatim (byte-identical) into `lib/portfolio-intelligence/health/`; TE-0006B consolidated into `evaluatePositionObjective()`, producing canonical `PortfolioObjective[]` instead of a bespoke model, with 16 parity tests proving zero behavior change against the original nine trigger branches; stable rule IDs added to the contract; `app/portfolio/page.tsx` now consumes `lib/portfolio-intelligence` directly.

## Upcoming Work

Sprint 3 continues with items explicitly deferred out of PI-0001 and PI-0002 (see the "Later" sections in `planning/SPRINT3_PORTFOLIO_INTELLIGENCE_PLAN.md` and `planning/SPRINT3_PI0002_PLAN.md`):

- Reconcile `features/portfolio/priorities/` (TE-0006C, Daily Priority List) ranking with `PortfolioObjective` ranking (TE-0006A/B reconciliation itself is done as of PI-0002)
- Objective expansion into full analyses
- Decision history / persistence layer
- Daily Briefing
- Portfolio page presentation of `PortfolioObjective[]`
- Wiring `lib/autopilot` as a consumer of `lib/portfolio-intelligence`
- Real candidate-analysis linking for `DEPLOY_IDLE_CASH`

No paper or live execution is allowed in any of the above.

