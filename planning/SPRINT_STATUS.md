# TradeEdge — Sprint Status

**Status:** Active operational source of truth  
**Last Updated:** 2026-07-17  
**Primary Branch:** `main`  
**Long-Lived Development Branch:** `feature/autopilot`

## Current State

Portfolio Intelligence implementation through **PI-0013** is complete and merged into `main`.

**PI-0014 — Marketable Pricing for Risk-Gating, Phase 1** is complete and merged into `main` (merge commit `2c79d5e`). It was implemented, recovered after an out-of-band `main` reset lost it from all reachable refs, reviewed by the Product Owner (required refactor completed), corrected through a Corrective Closeout sprint (documentation drift, missing-marketable-data test coverage, invalid-quote test coverage, unknown-liquidity classification fix, generated-artifact cleanup), accepted, and merged. The temporary branch (`feature/marketable-pricing`) was deleted locally and remotely per the standard short-lived-branch lifecycle. See `docs/reviews/PI-0014-Marketable-Pricing-Implementation-Report.md` for the full account (Process Note, Product Owner Addendum, Corrective Closeout Addendum) and validation results.

**OE-0001 — Opportunity Engine Foundation** is implemented on `feature/opportunity-engine-foundation` (based on `main` @ `a86c92d`) and **awaiting Product Owner review**. It is not merged into `main`. It implements roadmap item TE-0007 / Master Spec §4.1: a canonical, deterministic ranking layer (`lib/opportunity-engine/`) over already-computed Decision Engine evaluations, one real end-to-end-connected candidate adapter (against `DecisionAnalysis`, the shape already produced by the existing `POST /api/autopilot/recommendations` route), and a read-only "Best Opportunities" tab in the existing Income Engine experience. The panel currently renders with an explicit, honest blocker notice rather than fabricated data — no page yet holds a live `DecisionAnalysis[]` feed to give it; see `docs/design/OE-0001-Opportunity-Engine-Foundation.md` §7 for the exact architectural reason and the two future-sprint options that would close the gap. See `docs/reviews/OE-0001-Implementation-Report.md` for the full account and validation results.

**No further sprint is active beyond OE-0001.** Once OE-0001 is reviewed, the Product Owner must review real-world Portfolio Review and Daily Briefing behavior, unresolved follow-ups, and the roadmap, then recommend the next frozen sprint (which may be one of the backlog items OE-0001 surfaced — see its implementation report §8).

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
- `main` synchronized with `origin/main`, both at `2c79d5e` (PI-0014 merge commit)
- `feature/autopilot` synchronized with `origin/feature/autopilot`, untouched by PI-0014 work
- `feature/marketable-pricing` — deleted locally and remotely after PI-0014's accepted merge, per the standard short-lived-branch lifecycle. No longer exists.
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
| PI-0014 | Marketable Pricing for Risk-Gating, Phase 1 | Complete ✅ | Stop-loss, take-profit, emergency-exit, and Cut Losses gates now consider marketable (executable) pricing alongside mid; `PositionValuation` valuation layer; liquidity-tier classification |

PI-0012A and PI-0013 were merged to `main` in commit `a90f8f1` (`merge: portfolio intelligence`). PI-0014 was merged to `main` in commit `2c79d5e` (`merge: PI-0014 marketable pricing for risk-gating`).

## Validation Baseline

The most recently documented Portfolio Intelligence baseline before PI-0012A/PI-0013 was:

- 398 tests passing repo-wide
- `tsc --noEmit` clean
- Production build attempts subject to the established five-minute environment limit

PI-0012A and PI-0013 were implementation-reviewed and merged. Real-position, multi-session acceptance validation of the combined Portfolio Review and Daily Briefing workflow remains pending.

**PI-0014 (merged, commit `2c79d5e`)** validation results at merge: 643 tests passing repo-wide; `tsc --noEmit` clean; local production build subject to the documented environment limitation (hangs at the initial Next.js banner in this sandbox, not treated as a regression given clean TypeScript and passing tests — Vercel remains the authoritative build check). See `docs/reviews/PI-0014-Marketable-Pricing-Implementation-Report.md` for the full account, including the Corrective Closeout Addendum.

**OE-0001 (implemented on `feature/opportunity-engine-foundation`, not yet merged)** validation results: 675 tests passing repo-wide (643 + 32 new `lib/opportunity-engine` tests, no other test affected); `tsc --noEmit` clean; local production build reproduces the same documented environment limitation as PI-0014 (hangs at the initial Next.js banner, not treated as a regression). See `docs/reviews/OE-0001-Implementation-Report.md`.

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

PI-0014 is now merged. No next sprint is selected, recommended, or defined in this document — that determination belongs to the Product Owner.

Do not start another feature merely because PI-0013 and PI-0014 are merged.

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