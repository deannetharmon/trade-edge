# Sprint 3 — Portfolio Intelligence

**Branch:** `feature/portfolio-intelligence`
**First slice:** PI-0001 — Portfolio Objective Engine
**Date:** 2026-07-11
**Status:** First slice complete, automated and locally verified. Production/Vercel confirmation pending.

---

## Product objective

Sprint 2 built the Decision Engine, which answers: *is this candidate a good trade?* Sprint 3 must begin answering a different question: *given the entire portfolio, what deserves the trader's attention today?*

This is a **recommendation-only sprint**. No paper execution, no live execution, no order submission, no simulated fills, no position mutation, no automatic rolling/closing/opening. Every deliverable in this sprint is explanation and prioritization, not action.

## Context: related prior work

Two tickets from an earlier initiative already exist in this codebase and touch similar territory:

- **TE-0006A — Portfolio Health Scoring Framework** (`docs/tickets/TE-0006A-portfolio-health-scoring-framework.md`, `docs/reviews/TE-0006A-Implementation-Report.md`) — a per-position 0–100 health score with factor-level explanations, implemented inline inside `app/portfolio/page.tsx`.
- **TE-0006B — Portfolio Recommendation Rules** (`docs/tickets/TE-0006B-portfolio-recommendation-rules.md`, `docs/reviews/TE-0006B-Implementation-Report.md`) — rule-based recommendations, also inline in the Portfolio page.

Both predate this canonical `lib/portfolio-intelligence/` layer and are **not** superseded or consumed by PI-0001 — they remain separate, page-local logic. Reconciling TE-0006A/B's inline scoring with the new `PortfolioObjective` model is real open work for a later Sprint 3 item, not attempted in this first slice. Flagging this now so it isn't rediscovered as a surprise later.

## Architecture

```text
lib/decision-engine/
    Single-candidate reasoning
    DecisionAnalysis

lib/portfolio-intelligence/     <- new in this slice
    Portfolio-level reasoning
    PortfolioObjective
    Objective prioritization
    Links objectives to DecisionAnalysis when applicable

lib/autopilot/
    Future consumer/orchestrator only (not wired up in this slice)
```

Dependency direction is one-way and enforced by import discipline (not yet by a lint rule): `lib/portfolio-intelligence` may import types from `lib/decision-engine` (for linking), but never from `lib/autopilot`. `lib/autopilot` will eventually consume `lib/portfolio-intelligence`, not the other way around.

`lib/portfolio-intelligence` does not duplicate `lib/decision-engine`'s single-candidate reasoning. Where an objective concerns a position/candidate that already has a `DecisionAnalysis`, it links to it via `linkedDecisionAnalysis` rather than re-deriving that reasoning.

## First-slice scope: PI-0001 — Portfolio Objective Engine

A pure, deterministic, stateless function that converts a `PortfolioIntelligenceContext` snapshot into ranked `PortfolioObjective[]`. No network calls, no persistence, no randomness in ranking.

### Files

- `lib/portfolio-intelligence/types.ts` — `PortfolioObjective` contract and all supporting types (evidence, concerns, impacts, review triggers, evaluation input contracts).
- `lib/portfolio-intelligence/evaluatePortfolioObjectives.ts` — the pure evaluator, one rule function per objective type, plus deterministic ranking.
- `lib/portfolio-intelligence/index.ts` — public exports.
- `test/fixtures/portfolioIntelligenceFixtures.ts` — shared deterministic fixture builders.
- `lib/portfolio-intelligence/__tests__/evaluatePortfolioObjectives.test.ts` — PI-001 through PI-010 plus safety tests.

### PortfolioObjective contract

Every objective carries: `id`, `createdAt`, `version`, `type`, `title`, `summary`, `priority`, `urgency`, `confidence`, `status`, `source`, `subject`, `rationale`, `supportingEvidence`, `concerns`, `portfolioImpact`, `incomeImpact`, `riskImpact`, `capitalImpact`, `reviewTriggers`, an optional `linkedDecisionAnalysis`, and `metadata.{executionAllowed: false, paperExecutionAllowed: false, rulesEvaluated, rulesTriggered}`.

`portfolioImpact` / `incomeImpact` / `riskImpact` / `capitalImpact` share one `ObjectiveImpact` shape (`direction`, `magnitude`, `explanation`, optional `estimatedDollarValue`) rather than four bespoke shapes — they're the same kind of statement applied to four dimensions.

Ten objective types are supported: `MANAGE_POSITION`, `CLOSE_FOR_PROFIT`, `REVIEW_THREATENED_POSITION`, `ROLL_POSITION`, `DEPLOY_IDLE_CASH`, `INCREASE_INCOME`, `REDUCE_CONCENTRATION`, `PRESERVE_BUYING_POWER`, `REVIEW_PENDING_ORDER`, `WAIT`.

Priority: `critical | high | medium | low | informational`. Urgency: `now | today | this_week | monitor | none`. Both are preserved as explainable, independent dimensions — never collapsed into one opaque score.

`status` is currently only ever `'active'` or `'informational'` in this slice's output. `'resolved'` / `'dismissed'` exist in the type for a future decision-history/persistence layer this slice does not implement.

### Rules implemented (Deliverable 3)

All ten rule categories from the spec are implemented as independent, additive rule functions:

1. Close for profit — triggers at/above the configured profit-target threshold (default matches this repo's established 50% convention); escalates to critical when earnings fall inside the expiration window or ≤2 DTE remain.
2. 21-DTE review — triggers at/inside the configured DTE threshold (default 21, matching the established time-stop convention); emits `ROLL_POSITION` instead of `MANAGE_POSITION` when the position carries an explicit `roll_review` management flag.
3. Assignment-aware CSP exception — a CSP with `assignmentIntent: 'willing'` at the DTE threshold is not force-closed; it gets a low-priority, monitor-urgency objective that explains the assignment intent instead.
4. Review threatened position — triggers on material loss (default threshold matches the established "2x credit loss stop" convention, expressed as `openPlPct <= -200`), an explicit `technical_breach`/`stop_triggered` management flag, or earnings inside expiration.
5. Deploy idle cash — triggers only when idle cash exceeds the configured threshold AND buying-power utilization and drawdown are both within safe ranges; never invents a specific trade, explicitly defers to a separate opportunity-discovery step.
6. Increase income — triggers when current income is materially (≥20%) below target and risk capacity remains; capped at `medium` priority by design so it can never outrank a critical position or capital-preservation objective.
7. Reduce concentration — one objective per symbol or sector that exceeds its configured limit; `high` priority when the breach is ≥1.5x the limit, `medium` otherwise.
8. Preserve buying power — triggers on buying-power utilization above the configured limit (`high`) or drawdown at/above the defensive threshold (`critical`, mirroring the Autopilot layer's own drawdown circuit breaker). When this fires on a utilization breach, `DEPLOY_IDLE_CASH` is suppressed outright for the same run, not merely ranked lower.
9. Review pending order — triggers on staleness (age past threshold), material fill distance, or an explicit stale/review-required flag.
10. Wait — emitted exactly once, only when no other rule fired anything.

Default threshold values are chosen to match existing conventions already established elsewhere in this codebase (50% profit target, 21-DTE time stop, 2x credit loss stop from the trading methodology; 65% max buying-power utilization and 8% defensive drawdown from `AutopilotThresholds` defaults) so the two layers agree on what these terms mean, even though `lib/portfolio-intelligence` does not import from `lib/autopilot` to get them.

### Explainable prioritization (Deliverable 4)

Ranking is a three-key deterministic sort: priority rank, then a fixed category rank per objective type (mirroring the stated general order: protect capital → time-sensitive positions → harvest profit → pending orders → portfolio construction → deploy capital/income → wait), then urgency rank, then confidence descending. No random value (including the objective's own `id`) participates in the sort. A critical threatened-position objective cannot be outranked by a new-income objective, because `INCREASE_INCOME` and `DEPLOY_IDLE_CASH` are structurally capped below `critical` priority in their own rule functions — this is enforced by the priority assignment itself, not left to ranking order alone.

### DecisionAnalysis linking (Deliverable 5)

`PortfolioPositionInput.linkedDecisionAnalysis` passes straight through to the resulting objective when present. `DEPLOY_IDLE_CASH` linking to "the highest-ranked candidate analysis" is explicitly future work — not implemented here, since it requires wiring to actual candidate discovery, which this slice deliberately does not touch.

## Test scenarios (Deliverable 6)

All ten scenarios (PI-001 through PI-010) plus a safety suite are implemented in `lib/portfolio-intelligence/__tests__/evaluatePortfolioObjectives.test.ts` — 25 tests total, all passing. See "Automated results" below for the current count across the whole repo.

## Safety boundary

- `executionAllowed: false` and `paperExecutionAllowed: false` are hard-coded on every objective, verified across a large mixed scenario.
- The evaluator is a pure function: no imports of any persistence, Redis, or broker/order-submission code anywhere in `lib/portfolio-intelligence/`. Verified structurally (no such imports exist in the module) and behaviorally (a purity test confirms identical input produces equivalent output, and an input-mutation test confirms the context object itself is never modified).
- No paper-account mutation, position mutation, or order submission is possible from this layer in its current form — there is no code path into any of those systems at all.

## Exit criteria — status

| Criterion | Status |
|---|---|
| `PortfolioObjective` is the canonical portfolio-level recommendation contract | ✅ |
| Pure deterministic evaluator returns ranked portfolio objectives | ✅ |
| Existing-position and portfolio-level objectives both supported | ✅ |
| Critical risk/management objectives outrank new-income objectives | ✅ (PI-004) |
| Assignment-aware CSP behavior preserved | ✅ (PI-003) |
| `WAIT` supported as a legitimate result | ✅ (PI-009) |
| Every objective is explainable | ✅ (rationale + evidence + concerns + impacts on every objective) |
| Every result prohibits paper and live execution | ✅ (safety tests) |
| Automated tests pass | ✅ — see current count in `SPRINT_STATUS.md` |
| TypeScript passes | ✅ (`tsc --noEmit` clean) |
| Vercel production build passes | ⬜ Manual — confirm after push |
| No unrelated application behavior changed | ✅ — additive only, no existing files modified |

## Later Sprint 3 items (explicitly not built in this first patch)

- Portfolio health dimensions (and reconciling with the existing TE-0006A/B inline scoring in the Portfolio page)
- Objective expansion into full analyses
- Decision history (the `resolved`/`dismissed` status values reserved but unused in this slice)
- Daily Briefing
- Portfolio page presentation (surfacing `PortfolioObjective[]` in the UI)
- Wiring `lib/autopilot` as a consumer of `lib/portfolio-intelligence`
- `DEPLOY_IDLE_CASH` linking to a real candidate analysis via actual opportunity discovery
- TastyTrade-backed live context construction (this slice uses only supplied data contracts and fixtures, no network calls)

Also preserved for later: the Sprint 10 requirement to update end-user help documentation once these workflows stabilize (not yet, since this is still an internal, unreleased data layer with no UI surface).
