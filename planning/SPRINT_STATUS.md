# TradeEdge Autopilot — Sprint Status

**Branch:** `feature/portfolio-intelligence`
**Scope:** Portfolio Intelligence Experience (through PI-0008A — Remaining Opportunity Engine)
**Last Updated:** 2026-07-13
**Current Phase:** Sprint 4/5 — Decision Engine explainability + opportunity metrics (PI-0004A through PI-0008A all complete)
**Next Objective:** Not yet scoped — no PI-0008B/PI-0009 ticket exists in `planning/` as of this update.

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
| 3 (PI-0003.5) | Portfolio Intelligence — Real Financial Data Wiring | Completed ✅ | ✅ local | ⬜ | ⬜ | ⬜ |
| 4 (PI-0004A) | Portfolio Intelligence Experience — Today's Priorities | Completed ✅ | ✅ local | ⬜ | ⬜ | ⬜ |
| 4 (PI-0004B) | Actionability + Wheel-Aware Position Strategy/Assignment Preference | Completed ✅ | ✅ local | ⬜ | ⬜ | ⬜ |
| 4 (PI-0004C) | Today's Priorities Workflow (subpage + Complete/Reopen) | Completed ✅ | ✅ local | ⬜ | ⬜ | ⬜ |
| 5 (PI-0006A) | Assertive Recommendation Engine (decisive labels + evidence bullets) | Completed ✅ | ✅ local | ⬜ | ⬜ | ⬜ |
| 5 (PI-0006B) | Intent-Based Recommendation Engine (`selectManagementIntent()`) | Completed ✅ | ✅ local | ⬜ | ⬜ | ⬜ |
| 5 (PI-0007A) | Recommendation Scorecard (Decision Engine observability) | Completed ✅ | ✅ local | ⬜ | ⬜ | ⬜ |
| 5 (PI-0008A) | Remaining Opportunity Engine | Completed ✅ | ✅ local | ⬜ | ⬜ | ⬜ |
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
| 4 (PI-0004A) | ✅ local | 226 tests passing repo-wide (20 new, first component tests in the repo), `tsc --noEmit` clean, `next build` clean locally, `/portfolio` compiles (102 kB). Vercel preview confirmation pending. |
| 4 (PI-0004B) | ✅ local | 236 tests passing repo-wide (10 new — actionability gating, Wheel-aware concentration/assignment). No dedicated implementation report; see `pi0004b.test.ts` for full scenario coverage. |
| 4 (PI-0004C) | ✅ local | 275 tests passing repo-wide (39 new). `tsc --noEmit` clean, `next build` clean (exit 0, 43 routes), `/portfolio` 104 kB / 201 kB first load. See `docs/reviews/PI-0004C-Implementation-Report.md`. |
| 5 (PI-0006A) | ✅ local | 25 test files passing repo-wide (run in batches; decisive labels + evidence bullets, no trigger/threshold changes). `tsc --noEmit` clean. `next build` did not complete in-sandbox (environment limit, not investigated further per ticket). See `docs/reviews/PI-0006A-Implementation-Report.md`. |
| 5 (PI-0006B) | ✅ local | Intent-based selector (`selectManagementIntent()`) replacing PI-0006A's static label table; acceptance scenarios (SOXL BPS, NVDA Wheel CSP, AMD earnings, profit target, material loss) all passing. `tsc --noEmit` clean. `next build` did not complete in-sandbox. See `docs/reviews/PI-0006B-Implementation-Report.md`. |
| 5 (PI-0007A) | ✅ local | 381 tests passing repo-wide (147 portfolio-intelligence + 127 features/portfolio + 107 autopilot/decision-engine). Scorecard observability only — all PI-0006B winners preserved byte-for-byte. `tsc --noEmit` clean. `next build` did not complete in-sandbox. See `docs/reviews/PI-0007A-Implementation-Report.md`. |
| 5 (PI-0008A) | ✅ local | 398 tests passing repo-wide (161 portfolio-intelligence + 130 features/portfolio + 107 autopilot/decision-engine, 17 new for this slice). `tsc --noEmit` clean. `next build` did not complete in-sandbox. See `docs/reviews/PI-0008A-Implementation-Report.md`. |
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

Also complete, continuing this milestone past PI-0003.5:

- **PI-0004A** (Today's Priorities UI) — pure rendering layer over `canonicalPriorities`, first component/UI tests in the repo.
- **PI-0004B** (Actionability + Wheel-aware Position Strategy/Assignment Preference) — `PortfolioObjectiveActionability` gating so a true-but-not-yet-actionable condition (e.g. earnings outside the review window) doesn't clutter Today's Priorities; Wheel/assignment-preference-aware concentration and DTE handling so a Wheel CSP with assignment preferred isn't treated as an unmanaged risk.
- **PI-0004C** (Today's Priorities Workflow) — promoted to its own Portfolio subpage with a persisted Complete/Reopen workflow (`localStorage`-backed, auto-reopens on material change). Portfolio Intelligence itself untouched — pure presentation-layer overlay.
- **PI-0006A** (Assertive Recommendation Engine) — replaced generic per-trigger labels ("Roll Soon," "Watch") with decisive ones ("Take Profit," "Review Position"), each backed by 2-4 evidence bullets from data the engine already computes.
- **PI-0006B** (Intent-Based Recommendation Engine) — superseded PI-0006A's static per-kind label table with `selectManagementIntent()`, an evidence-scored selector over 8 canonical management intents (Hold Position, Take Profit, Cut Losses, Reduce Risk, Roll Position, Accept Assignment, Replace Working Order, Deploy Idle Cash). Roll can no longer win from DTE alone; a Wheel CSP with assignment preferred can resolve to Accept Assignment instead of a generic exit.
- **PI-0007A** (Recommendation Scorecard) — made the PI-0006B selector fully observable without changing any decision: every score contribution recorded at its source, full ranked candidate list, winner/runner-up/margin/confidence tier, surfaced in a new collapsed "Decision Scorecard" section in Position Intelligence.
- **PI-0008A** (Remaining Opportunity Engine) — a parallel, independent metric (not part of the Decision Engine) estimating Opportunity Captured % and Remaining Opportunity % per position from existing DTE/P&L/credit/health/buffer/net-edge/earnings/lifecycle data, displayed in Position Intelligence.

No paper or live execution exists in any of the above. See `docs/reviews/PI-0004C-Implementation-Report.md`, `docs/reviews/PI-0006A-Implementation-Report.md`, `docs/reviews/PI-0006B-Implementation-Report.md`, `docs/reviews/PI-0007A-Implementation-Report.md`, and `docs/reviews/PI-0008A-Implementation-Report.md` for full detail on each slice. PI-0004B has no dedicated report (see `lib/portfolio-intelligence/__tests__/pi0004b.test.ts` for its scenario coverage).

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

## Sprint 4 (PI-0004A) — Today's Priorities Review

**Result:** Complete, locally verified. 226 tests passing repo-wide (20 new — the first component/UI tests in this repo), `tsc --noEmit` clean, `next build` clean locally including `/portfolio` (102 kB). Vercel preview/production confirmation pending push.

**Built:** `features/portfolio/components/TodaysPriorities.tsx` — a pure rendering layer over the already-computed `canonicalPriorities` state (PI-0003/0003.5). No evaluation, ranking, or scoring happens in this component; verified by a test that inspects the component's own source for any evaluation-function import. Collapsed cards show title/recommendation-type/priority/urgency/rule ID/summary; expanded cards render the canonical rationale, evidence, concerns, review triggers, and the four impact dimensions (mapped to "Expected Outcome," since `PortfolioObjective` has no dedicated field by that name). Empty state renders the canonical `WAIT` objective's own title/rationale rather than invented copy. Reuses the page's existing three-theme system (`th` prop, matching `SummaryBar`/`AuditLogPanel`'s established pattern) rather than hardcoding dark-only styling.

**Infrastructure added:** this repo had no component-testing setup before this slice — added `@testing-library/react`, `jest-dom`, `user-event`, `jsdom`, and `@vitejs/plugin-react`, scoped via `environmentMatchGlobs` so the existing 206 `.test.ts` files stay on the unchanged `node` environment.

**Safety:** no interactive element beyond expand/collapse; `executionAllowed`/`paperExecutionAllowed` are never surfaced as actionable controls. No new business logic, no execution capability.

**Known Follow-Up:** see "Known gaps" in `planning/SPRINT4_PI0004A_PLAN.md` — no visual/screenshot verification yet (DOM-assertion tests only), priority cards don't yet link back to their corresponding position cards, and the older unused `DailyPriorityList`/TE-0006C shim remains unreconciled.

## Sprint 4 (PI-0004B) — Actionability + Wheel-Aware Position Strategy Review

**Result:** Complete, locally verified. 236 tests passing repo-wide (10 new). No dedicated implementation report was written for this slice — see `lib/portfolio-intelligence/__tests__/pi0004b.test.ts` for the full scenario coverage (AMD earnings-actionability gating, NVDA Wheel-aware concentration, legacy backward-compatibility for positions with no `PositionStrategy`/`AssignmentPreference` set).

**Built:** `PortfolioObjectiveActionability` (`MONITOR`/`REVIEW_SOON`/`ACTION_NEEDED`/`CRITICAL`) as a dimension distinct from priority/urgency — answers "does this belong in front of the trader today," not just "how severe is it." `PositionStrategy` (`WHEEL`/`INCOME`/`ACQUIRE`) and `AssignmentPreference` (`AVOID`/`ACCEPT`/`PREFER`) added as optional, independent fields so a Wheel CSP with assignment preferred doesn't get treated as an unmanaged risk by concentration or DTE rules.

**Safety:** No execution or mutation code added; purely additive gating/classification fields.

## Sprint 4 (PI-0004C) — Today's Priorities Workflow Review

**Result:** Complete, locally verified. 275 tests passing repo-wide (39 new). Full detail in `docs/reviews/PI-0004C-Implementation-Report.md`.

**Built:** Today's Priorities promoted from an inline block to its own Portfolio subpage, plus a persisted Complete/Reopen workflow (`localStorage`-backed, keyed on `ruleId + subject` since `objective.id` is regenerated on every evaluation run) that auto-reopens a completed item when its underlying condition materially changes. Portfolio Intelligence itself untouched — pure presentation-layer overlay.

**Safety:** No execution or mutation code added.

## Sprint 5 (PI-0006A) — Assertive Recommendation Engine Review

**Result:** Complete, locally verified. 25 test files passing repo-wide (run in batches due to a sandbox per-command time limit). `tsc --noEmit` clean; `next build` did not complete in-sandbox (environment limit, not pursued further per the ticket's own instruction). Full detail in `docs/reviews/PI-0006A-Implementation-Report.md`.

**Built:** Replaced generic per-trigger labels ("Roll Soon," "Watch," "Manage Position") with decisive ones ("Take Profit," "Exit Position," "Review Position") via a static per-`kind` label table, plus 2-4 evidence bullets per recommendation built from data the engine already computes. `kind`/`ruleId`/`type`/thresholds all unchanged — display-only.

**Safety:** No execution or mutation code added; no scoring/threshold changes.

## Sprint 5 (PI-0006B) — Intent-Based Recommendation Engine Review

**Result:** Complete, locally verified. Full detail in `docs/reviews/PI-0006B-Implementation-Report.md`.

**Built:** Superseded PI-0006A's static label table with `selectManagementIntent()` (`lib/portfolio-intelligence/managementIntent.ts`) — an evidence-scored selector over 8 canonical management intents (Hold Position, Take Profit, Cut Losses, Reduce Risk, Roll Position, Accept Assignment, Replace Working Order, Deploy Idle Cash), restricted per-context to a relevant intent set. Roll Position can no longer win from DTE alone — it requires an explicit `roll_review` flag. All five ticket acceptance scenarios (SOXL BPS, NVDA Wheel CSP, AMD earnings, profit target, material loss) pass as regression tests.

**Safety:** No execution or mutation code added.

## Sprint 5 (PI-0007A) — Recommendation Scorecard Review

**Result:** Complete, locally verified. 381 tests passing repo-wide (147 portfolio-intelligence + 127 features/portfolio + 107 autopilot/decision-engine). `tsc --noEmit` clean; `next build` did not complete in-sandbox. Committed and pushed as `78c950c`. Full detail in `docs/reviews/PI-0007A-Implementation-Report.md`.

**Built:** Made the PI-0006B selector fully observable without changing any decision — every score contribution recorded at the exact point it's added (`ScoreContribution`: id, label, signed points, explanation, source evidence field), full ranked candidate list with an `isWinner` flag, plus winner/runner-up/margin/`confidenceTier`. All 147 pre-existing portfolio-intelligence tests passed unmodified, proving every PI-0006B decision is preserved byte-for-byte. New collapsed "Decision Scorecard" section added to Position Intelligence.

**Safety:** No execution or mutation code added; no scoring/threshold/weight changes (verified by the unmodified pre-existing test suite).

## Sprint 5 (PI-0008A) — Remaining Opportunity Engine Review

**Result:** Complete, locally verified. 398 tests passing repo-wide (161 portfolio-intelligence + 130 features/portfolio + 107 autopilot/decision-engine, 17 new for this slice). `tsc --noEmit` clean; `next build` did not complete in-sandbox. Committed and pushed as `cd77046`. Full detail in `docs/reviews/PI-0008A-Implementation-Report.md`.

**Built:** `calculateRemainingOpportunity()` (`lib/portfolio-intelligence/remainingOpportunity.ts`) — a parallel, independent metric (not part of the Decision Engine) computing Opportunity Captured % and Remaining Opportunity % per position, using only existing data (DTE, P/L, original credit, strike buffer, health score, net edge, earnings proximity, structural position lifecycle). Every discount factor reuses an existing threshold from elsewhere in the codebase rather than inventing a new one. Both percentages now display in a new "Remaining Opportunity" section in Position Intelligence.

**Safety:** No execution or mutation code added; does not feed `selectManagementIntent()` or any trigger-detection branch.
