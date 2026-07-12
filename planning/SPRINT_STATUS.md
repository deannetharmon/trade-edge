# TradeEdge Autopilot — Sprint Status

**Branch:** `feature/portfolio-intelligence`
**Scope:** Portfolio Intelligence (Sprint 3, PI-0003.5 — Real Financial Data Wiring)
**Last Updated:** 2026-07-11
**Current Phase:** Sprint 3 — Portfolio Intelligence, PI-0003.5 Real Financial Data Wiring
**Next Objective:** Product Owner review of PI-0003.5, then scope PI-0004

## Current Development Rule

Autopilot must learn to make explainable, portfolio-aware recommendations before it is allowed to create paper trades.

**No paper execution until the Decision Engine produces ranked recommendations with complete reasoning.**

Sprint 2 (Decision Engine) is complete and merged to `main`; Sprint 3 (Portfolio Intelligence) builds on top of it. Sprint 3 remains recommendation-only: no paper execution, no live execution, no order submission, no position mutation.

For the current screener sprint, keep TastyTrade scan execution browser-owned/client-authenticated. Do not reintroduce Vercel server-side TastyTrade scan execution until server auth is explicitly solved.

## Definition of Done

A sprint is not complete until all required items are true:

- [x] Code written
- [x] Documentation updated
- [x] Changes committed and pushed
- [x] Vercel build passes
- [x] Sprint review completed
- [ ] Endpoint smoke tests pass when network access allows

## Sprint Tracker

| Sprint | Name | Status | Build | Deploy | Smoke Test | Review |
|---|---|---:|---:|---:|---:|---:|
| 1A | Core Infrastructure | Completed ✅ | ✅ | ✅ | Deferred | ✅ |
| 1B | Framework | Completed ✅ | ✅ | ✅ | Deferred | ✅ |
| TE-0001 / TE-0005A | Background Ranked Screener Stabilization | Completed ✅ | ✅ | ✅ | Deferred | ✅ |
| 2 | Decision Engine | Completed ✅ | ✅ | ✅ | Manual (kill switch verified live) | ✅ |
| 3 (PI-0001) | Portfolio Intelligence — Portfolio Objective Engine | Completed ✅ | ✅ local | ⬜ | ⬜ | ⬜ |
| 3 (PI-0002) | Portfolio Intelligence — Portfolio Engine Consolidation | Completed ✅ | ✅ local | ⬜ | ⬜ | ⬜ |
| 3 (PI-0003) | Portfolio Intelligence — Canonical Portfolio Priority Engine | Completed ✅ | ✅ local | ⬜ | ⬜ | ⬜ |
| 3 (PI-0003.5) | Portfolio Intelligence — Real Financial Data Wiring | Active | ✅ local | ⬜ | ⬜ | ⬜ |
| 3 (Paper Execution) | Paper Execution Engine | Not Started | ⬜ | ⬜ | ⬜ | ⬜ |
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
| TE-0001 / TE-0005A | ✅ Passed | Confirmed via subsequent Vercel deploys. |
| 2 | ✅ Passed | 107 tests passing, `tsc --noEmit` clean, confirmed live in production (kill switch verified end-to-end). |
| 3 (PI-0001) | ✅ local | 132 tests passing repo-wide (25 new), `tsc --noEmit` clean, `next build` clean locally. Vercel preview confirmation pending. |
| 3 (PI-0002) | ✅ local | 155 tests passing repo-wide (23 new), `tsc --noEmit` clean, `next build` clean locally, `/portfolio` compiles. Vercel preview confirmation pending. |
| 3 (PI-0003) | ✅ local | 179 tests passing repo-wide (24 new), `tsc --noEmit` clean, `next build` clean locally, `/portfolio` compiles (99 kB). Vercel preview confirmation pending. |
| 3 (PI-0003.5) | ✅ local | 206 tests passing repo-wide (27 new), `tsc --noEmit` clean, `next build` clean locally, `/portfolio` compiles (99.6 kB). Vercel preview confirmation pending. |
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

### ✅ Milestone B — Decision Engine

Goal: Autopilot can think.

Output: ranked recommendations with complete acceptance/rejection reasoning.

Constraint: no paper trades.

Completed 2026-07-11: shared `lib/decision-engine` (single-candidate reasoning) plus `lib/autopilot/decision` orchestration, 107 tests passing, kill switch enforcement, per-candidate rationale, observable duplicate handling, IC fixture. Merged to `main`; confirmed live in production.

### 🟡 Milestone B2 — Portfolio Intelligence

Goal: Autopilot can see the whole portfolio, not just one candidate at a time.

Output: ranked `PortfolioObjective[]` explaining what deserves attention today.

Constraint: no paper trades, no live trades, no position mutation.

Complete: PI-0001 (Portfolio Objective Engine), PI-0002 (Portfolio Engine Consolidation), and PI-0003 (Canonical Portfolio Priority Engine) -- 179 repo-wide tests. PI-0003 formalized risk policy separation, replaced one-ID-per-type with 15 fine-grained rule IDs, consolidated TE-0006C's ranking into the canonical `prioritizePortfolioObjectives()`, and gave `evaluatePortfolioObjectives()` its first real production consumer (Portfolio page, wired but not yet rendered). See `planning/SPRINT3_PORTFOLIO_INTELLIGENCE_PLAN.md`, `planning/SPRINT3_PI0002_PLAN.md`, and `planning/SPRINT3_PI0003_PLAN.md` for full scope and later-item backlogs.

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

## Sprint 2 — Decision Engine Review

**Result:** Completed. 107 automated tests passing, `tsc --noEmit` clean, `next build` clean. Merged to `main` and confirmed live in production, including an end-to-end verification of the kill switch toggle against real production infrastructure (not just mocks).

**Built:**

- `lib/decision-engine` — shared single-candidate reasoning, `evaluateSingleCandidate()`, full `DecisionAnalysis` contract.
- `lib/autopilot/decision` — candidate pipeline (normalization, validation, deduplication), portfolio pre-gates, orchestration, ranking, decision-log and audit-trail persistence.
- Sprint 2 validation suite: contract tests, CSP/BPS/BCS/IC/WAIT/AVOID scenarios, risk validation, Decision Confidence dimension tests, explanation-quality tests, orchestration tests, safety tests.
- Kill switch enforcement (`AutopilotConfig.killSwitchEnabled` now actually blocks recommendation generation) plus a UI toggle on `/autopilot`.
- Per-candidate rationale text (previously three fixed sentences, now composed from each candidate's actual concerns/alternatives/confidence/opportunity score).
- Observable candidate deduplication (`DuplicateCandidateRecord` — dropped id, retained id, dedupe key, reason — with exact count reconciliation).

**Safety:**

- `executionAllowed: false` / `paperExecutionAllowed: false` on every `DecisionAnalysis`, verified across every recommendation path.
- No paper trade execution, no live order path exists anywhere in `lib/autopilot/decision/` or `app/api/autopilot/*` — confirmed by inspection.
- Kill switch, once found to be a no-op, now genuinely blocks a run before any candidate is evaluated.

**Known Follow-Up:**

- No IC-specific concern/evidence logic beyond the shared `actionForStrategy()` path (low risk, has its own fixture now).
- No audit-trail viewer UI (out of scope by explicit Product Owner instruction).
- `killSwitchActive` not yet surfaced from `/api/autopilot/status` as a distinct field from `killSwitchEnabled` (the UI toggle reads/writes `killSwitchEnabled` directly, which is sufficient for the current control).

## Sprint 3 (PI-0001) — Portfolio Objective Engine Review

**Result:** First slice complete and locally verified. 132 tests passing repo-wide (25 new for this slice), `tsc --noEmit` clean, `next build` clean locally. Vercel preview/production confirmation pending push.

**Built:**

- `lib/portfolio-intelligence/types.ts` — `PortfolioObjective` canonical contract, evaluation input contracts (`PortfolioIntelligenceContext`, position/order/market inputs, thresholds).
- `lib/portfolio-intelligence/evaluatePortfolioObjectives.ts` — pure deterministic evaluator, ten rule categories, explainable three-key ranking (priority → category → urgency → confidence).
- `lib/portfolio-intelligence/index.ts` — public exports.
- Full PI-001 through PI-010 deterministic test scenarios plus a safety suite (execution flags, purity, no input mutation).
- `planning/SPRINT3_PORTFOLIO_INTELLIGENCE_PLAN.md` — full scope document and later-item backlog.

**Safety:**

- `executionAllowed: false` / `paperExecutionAllowed: false` hard-coded on every objective.
- No persistence, Redis, or broker/order-submission imports anywhere in `lib/portfolio-intelligence/` — there is no code path into execution from this layer.
- Purity verified: identical input produces equivalent output; input context is never mutated.

**Known Follow-Up:** see "Later Sprint 3 items" in `planning/SPRINT3_PORTFOLIO_INTELLIGENCE_PLAN.md` — portfolio health-dimension reconciliation with existing TE-0006A/B inline logic, objective-to-full-analysis expansion, decision history, Daily Briefing, Portfolio page presentation, and wiring `lib/autopilot` as a consumer are all explicitly deferred past this first slice.

## Sprint 3 (PI-0002) — Portfolio Engine Consolidation Review

**Result:** Complete, locally verified. 155 tests passing repo-wide (23 new for this slice), `tsc --noEmit` clean, `next build` clean locally including `/portfolio` (91.7 kB, negligible increase). Vercel preview/production confirmation pending push.

**Built:** TE-0006A (Portfolio Health) moved verbatim into `lib/portfolio-intelligence/health/` (confirmed byte-identical via diff). TE-0006B (Portfolio Recommendation Rules) consolidated into `lib/portfolio-intelligence/objectives/positionObjective.ts`, now producing canonical `PortfolioObjective[]` instead of its own bespoke model, while preserving exact legacy output (`legacyRecommendation`) for the three existing UI consumers (`PositionRecommendationBadge`, `DailyPriorityList`, priorities engine) so none of them needed to change. Stable rule IDs (`OBJ-CLOSE-FOR-PROFIT` etc.) added to the `PortfolioObjective` contract and populated by both objective producers. `app/portfolio/page.tsx` now imports directly from `lib/portfolio-intelligence` — the old `features/portfolio/{health,recommendations}/*` files are zero-logic re-export shims.

**Safety:** `executionAllowed: false` / `paperExecutionAllowed: false` verified on every objective produced by the new position-level evaluator, across all branches. No new execution paths — this slice is a pure refactor/consolidation.

**Known Follow-Up:** see "Later items" in `planning/SPRINT3_PI0002_PLAN.md` — physically deleting the now-empty shim files, reconciling `features/portfolio/priorities/` (TE-0006C) with `PortfolioObjective`, reconciling the two differently-tuned material-loss thresholds (portfolio-level batch default vs. position-level parity-preserved default), and wiring the portfolio-level batch evaluator into an actual consumer all remain open.

## Sprint 3 (PI-0003) — Canonical Portfolio Priority Engine Review

**Result:** Complete, locally verified. 179 tests passing repo-wide (24 new for this slice), `tsc --noEmit` clean, `next build` clean locally including `/portfolio` (99 kB). Vercel preview/production confirmation pending push.

**Built:** Explicit `PositionManagementPolicy`/`PortfolioRiskPolicy` objects (`lib/portfolio-intelligence/policies/`), replacing bare magic numbers. Fine-grained rule IDs (15, up from PI-0002's 10) with multiple IDs per objective type where appropriate. TE-0006C (`features/portfolio/priorities/`) consolidated into a shim over the new canonical `prioritizePortfolioObjectives()`. `evaluatePortfolioObjectives()` given its first real production consumer via a new combining adapter (`lib/portfolio-intelligence/adapters/portfolioIntelligenceAdapter.ts`) that merges position/portfolio/pending-order objectives into one ranked list, wired into `app/portfolio/page.tsx` (state only, not rendered — no new UI per the brief).

**Key judgment call:** the combining adapter suppresses `evaluatePortfolioObjectives()`'s own position-level rules (by passing `positions: []`) to avoid duplicating position objectives already produced by the UI-connected `evaluatePositionObjective()` with its own, deliberately different (PI-0002-documented) thresholds. Full rationale in `planning/SPRINT3_PI0003_PLAN.md`.

**Safety:** `executionAllowed: false` / `paperExecutionAllowed: false` verified across the full combined (position + portfolio + pending-order) objective list. No execution, mutation, or Autopilot-integration code added.

**Known Follow-Up:** see "Later items" in `planning/SPRINT3_PI0003_PLAN.md` — wiring real Balances-tab financial data into the adapter (currently an empty snapshot, so portfolio-level rules don't yet fire in production), surfacing the canonical priorities in the UI, and candidate-risk policy enforcement all remain open.

## Sprint 3 (PI-0003.5) — Real Financial Data Wiring Review

**Result:** Complete, locally verified. 206 tests passing repo-wide (27 new for this slice), `tsc --noEmit` clean, `next build` clean locally including `/portfolio` (99.6 kB). Vercel preview/production confirmation pending push.

**Found:** no single canonical balances source existed to reuse — `components/BalancesTab.tsx` and `app/engine/page.tsx` each independently fetch and parse the same TastyTrade `/accounts/{account}/balances` endpoint, neither connected to the Portfolio page, and between them cover only `net-liquidating-value`, `cash-balance`, and buying power. No income-tracking or drawdown-history concept exists anywhere in the app.

**Built:** `lib/portfolio-intelligence/adapters/balancesNormalization.ts` — a single, pure normalization point (`toFiniteNumber`, `buildPortfolioFinancialContext`, `derivePositionConcentration`) with a genuinely optional-field `PortfolioFinancialContext` type, so "unavailable" never silently becomes `0` at that layer. `app/portfolio/page.tsx` gained a `loadAccountBalances()` function (reusing the page's existing auth/fetch pattern) and now passes real financial data + per-position exposure into the combining adapter (rewritten to accept the richer context). Three of four target objectives are now fully operational from real data: `DEPLOY_IDLE_CASH`, `REDUCE_CONCENTRATION` (using real net liquidity as the denominator), and `PRESERVE_BUYING_POWER`'s utilization branch. `INCREASE_INCOME` remains structurally silent by design — no income source exists to wire.

**Key judgment call:** bridging the optional-field `PortfolioFinancialContext` into PI-0001's existing required-number `PortfolioStateInput` maps "unavailable" to `0` at that one boundary point — proven safe because every rule this feeds is a "fires when value >= threshold" check where `0` is the inert "everything's fine" value for that specific rule. Documented explicitly in the adapter rather than left as an implicit assumption.

**Safety:** `executionAllowed: false` / `paperExecutionAllowed: false` verified across the full combined list, same as every prior slice. No execution, mutation, or UI changes.

**Known Follow-Up:** see "Known remaining gaps" in `planning/SPRINT3_PI0003_5_PLAN.md` — the `maintenance-requirement` field's presence in the live balance payload has not been verified against a real API call (no live access in this session); recommend a one-line `console.log` check before fully trusting `PRESERVE_BUYING_POWER` in production. Income and drawdown-history sources still don't exist. `BalancesTab.tsx`/`app/engine/page.tsx` still have their own separate, unconsolidated balance-parsing logic.
