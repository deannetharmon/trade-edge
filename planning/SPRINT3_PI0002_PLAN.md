# Sprint 3, PI-0002 — Portfolio Engine Consolidation

**Branch:** `feature/portfolio-intelligence`
**Date:** 2026-07-11
**Status:** Complete, locally verified. Vercel preview confirmation pending push.

---

## Objective

Not a new feature. Eliminate duplicate portfolio-reasoning logic and establish `lib/portfolio-intelligence` as the single canonical portfolio reasoning engine. No intentional user-visible behavior change.

## What was actually found (differs slightly from the initial framing)

The PI-0002 brief described "two independent systems," with System 1 (Portfolio Health, Portfolio Recommendation Rules) living inline inside `app/portfolio/page.tsx`. On inspection, that wasn't quite accurate: TE-0006A and TE-0006B were **already extracted** into their own modules — `features/portfolio/health/` and `features/portfolio/recommendations/` — with `app/portfolio/page.tsx` calling them through two thin wrapper functions (`scorePortfolioPositionHealth`, `scorePortfolioRecommendation`) at a single call site (`attachSnapshotHistory`). A third module, `features/portfolio/priorities/` (TE-0006C, Daily Priority List), ranks positions using the recommendation output — not mentioned in the PI-0002 brief, and deliberately left untouched (see "Explicit scoping decisions" below).

This made the actual consolidation narrower and lower-risk than the brief implied: the business logic didn't need extracting from a 9,700-line page file, it needed relocating from `features/portfolio/` to `lib/portfolio-intelligence/` and reconciling with the canonical `PortfolioObjective` model.

## What moved

**TE-0006A (Portfolio Health) — moved verbatim.**
`features/portfolio/health/{health-types,health-factors,health-rules,health-score}.ts` → `lib/portfolio-intelligence/health/{types,factors,rules,score}.ts`. Confirmed byte-identical via diff at move time (only the file header comment changed). Already pure, deterministic, no React, structured (not opaque numbers) — it satisfied PI-0002's requirements before this sprint even started.

**TE-0006B (Portfolio Recommendation Rules) — consolidated, not just moved.**
The old `calculatePortfolioRecommendation()` returned its own bespoke `PortfolioRecommendation` model — exactly the "another recommendation model" PI-0002 says not to invent. It's replaced by `evaluatePositionObjective()` in `lib/portfolio-intelligence/objectives/positionObjective.ts`, which returns:

```ts
{ objective: PortfolioObjective | null; legacyRecommendation: PortfolioRecommendation }
```

from a single shared evaluation pass, preserving every original trigger condition, threshold, and string exactly (verified by 16 parity tests covering all nine original branches). `legacyRecommendation` exists solely so `PositionRecommendationBadge`, `DailyPriorityList`, and the priorities engine keep receiving byte-for-byte what they did before — none of those three files needed to change. `objective` is the new canonical output.

## Design decisions made under judgment (per PI-0002's explicit instruction to use judgment where the prompt leaves room)

1. **`ruleId` is a pure function of `type`, not of fine-grained trigger condition.** The ten stable IDs given (`OBJ-CLOSE-FOR-PROFIT` etc.) map 1:1 to the ten `PortfolioObjectiveType` values already established in PI-0001. Old recommendation `kind`s that don't have a dedicated canonical type — `assignment-risk`, `close-loser`, and `earnings-risk` all become `REVIEW_THREATENED_POSITION`; `roll-soon`, `place-gtc`, `let-expire`, and `watch` all become `MANAGE_POSITION` — are distinguished by `title`, `rationale`, and `metadata.rulesTriggered`, not by inventing an eleventh rule ID. This means `OBJ-MANAGE-21-DTE` now covers some non-DTE-driven cases (e.g. `place-gtc`); flagging this naming tension explicitly rather than silently living with it.

2. **`hold` produces no objective (`objective: null`), but always still produces a `legacyRecommendation`.** This is a deliberate, documented divergence from the old system (which always returned exactly one recommendation, even "nothing to do"), matching the philosophy `evaluatePortfolioObjectives` (PI-0001) already established: only emit an objective when something actually needs attention. It doesn't change what the UI renders (the UI still consumes `legacyRecommendation`, always populated), only what the new canonical layer considers worth surfacing.

3. **The position-level adapter uses its own thresholds, not `evaluatePortfolioObjectives`'s portfolio-level defaults.** PI-0001's batch evaluator defaults `materialLossPct` to -200 (2x credit loss stop). TE-0006B's original thresholds were -100 (critical) and -50-with-weak-health (high). Using PI-0001's defaults here would have been a real behavior regression. `positionObjective.ts` keeps its own thresholds, matching the original exactly. Reconciling these two threshold sets into one is explicitly deferred (see "Later items").

4. **Old `features/portfolio/*` files became re-export shims, not deletions.** Seven files (`health-types.ts`, `health-score.ts`, `health-rules.ts`, `health-factors.ts`, `recommendation-types.ts`, `recommendation-engine.ts`, `recommendation-rules.ts`) now contain zero logic — just re-exports pointing at the canonical `lib/portfolio-intelligence` location (two of them, `recommendation-engine.ts` and `recommendation-types.ts`, are actually consumed elsewhere and needed to keep working; the rest had no external consumers at all, confirmed by grep before touching them, and are shimmed anyway for a clean "moved, not duplicated" trail rather than being silently deleted by an automated script). Physically deleting these seven files is a trivial, low-risk future cleanup, not done here to keep this patch additive/corrective rather than destructive.

5. **`PortfolioObjective` is now wired onto `Position` (`portfolioObjective?: PortfolioObjective | null`) but not rendered anywhere.** Set alongside `recommendation` in `attachSnapshotHistory`, using zero additional computation (same `evaluatePositionObjective()` call produces both). This satisfies "no user-visible behavior changes" while avoiding a second data-plumbing pass whenever the next slice actually wants to surface it in the UI — which PI-0002's own constraints explicitly rule out doing in this slice ("Do NOT implement: ... New Portfolio UI").

## Explicit scoping decisions

- **`features/portfolio/priorities/` (TE-0006C, Daily Priority List) is untouched.** Not named in the PI-0002 brief, and its own bespoke ranking (`buildDailyPriorities`) is a different, dashboard-facing concern from PI-0001's `evaluatePortfolioObjectives` ranking. Reconciling the two ranking systems is real work, flagged as a later item, not attempted here to avoid "Dashboard redesign" scope creep the brief explicitly prohibited.
- **The portfolio-level batch evaluator (`evaluatePortfolioObjectives`) is not wired into the Portfolio page in this slice.** It still has zero callers anywhere in the app (same gap flagged in the PI-0001 report). This slice only consolidates the *per-position* recommendation path; wiring the page (or `lib/autopilot`) to the portfolio-level batch evaluator remains a separate, larger integration this brief's constraints (no dashboard redesign) don't cover.

## Files changed

**New:**
- `lib/portfolio-intelligence/ruleIds.ts`
- `lib/portfolio-intelligence/health/{types,factors,rules,score}.ts`
- `lib/portfolio-intelligence/objectives/positionObjective.ts`
- `lib/portfolio-intelligence/__tests__/health.test.ts`
- `lib/portfolio-intelligence/__tests__/positionObjective.test.ts`

**Modified:**
- `lib/portfolio-intelligence/types.ts` — added `ruleId` field and `PortfolioObjectiveRuleId` type
- `lib/portfolio-intelligence/evaluatePortfolioObjectives.ts` — populates `ruleId` via `OBJECTIVE_RULE_ID`
- `lib/portfolio-intelligence/index.ts` — exports the new health/objectives/ruleIds modules
- `app/portfolio/page.tsx` — two import lines, two wrapper functions, one call site, one new optional `Position` field. No rendering, sorting, filtering, or other logic touched.
- `features/portfolio/health/{health-types,health-score,health-rules,health-factors}.ts` — now re-export shims
- `features/portfolio/recommendations/{recommendation-types,recommendation-engine,recommendation-rules}.ts` — now re-export shims (`recommendation-engine.ts` keeps a thin wrapper function for backward compatibility)

## Tests

**23 new tests** (7 health parity, 16 position-objective parity/stable-ID/safety), on top of the 132 already passing (107 Sprint 2 + 25 PI-0001) = **155 total, all passing.**

Regression coverage per PI-0002's Step 7 list:
- Health score parity — 7 tests, locking in `calculatePositionHealthScore` behavior post-move.
- Close-for-profit, 21-DTE management, threatened positions, concentration handling, buying-power handling, income deficit handling, WAIT objective — already covered by PI-0001's 25 tests (portfolio-level rules, unaffected by this consolidation).
- Assignment-aware CSP behavior — covered by PI-0001's existing PI-003 test (portfolio-level) and implicitly preserved at the position level since `evaluatePositionObjective` doesn't alter assignment handling (TE-0006B never had assignment-aware CSP logic to begin with; that behavior lives entirely in PI-0001's `evaluateDteManagement`, untouched by this slice).
- Stable Rule IDs — 2 dedicated tests, covering both producers (position-level and portfolio-level).
- Recommendation parity — 12 tests, one or more per original branch (assignment-risk, close-loser ×2, earnings-risk, close-winner ×2, roll-soon ×2, place-gtc, let-expire, watch, hold).

## Exit criteria — status

| Criterion | Status |
|---|---|
| Portfolio page no longer owns reusable portfolio reasoning | ✅ |
| Portfolio Health is canonical | ✅ |
| Portfolio Objectives are canonical | ✅ |
| TE-0006A removed from page | ✅ (page calls `lib/portfolio-intelligence` directly) |
| TE-0006B removed from page | ✅ (page calls `lib/portfolio-intelligence` directly) |
| Portfolio page consumes shared engine | ✅ |
| Stable Rule IDs exist | ✅ |
| No duplicate reasoning remains | ✅ (old files are zero-logic shims) |
| Tests pass | ✅ 155/155 |
| TypeScript passes | ✅ `tsc --noEmit` clean |
| Local build passes | ✅ `next build` clean, `/portfolio` compiles |
| Vercel preview passes | ⬜ Manual — confirm after push |
| No behavior regressions | ✅ — parity tests + unchanged UI consumption shape |
| No execution paths added | ✅ — `executionAllowed`/`paperExecutionAllowed` false on every objective |

## Later items (explicitly not done in this patch)

- Physically delete the seven now-empty `features/portfolio/{health,recommendations}/*` shim files once confident nothing external still references the old paths.
- Reconcile `features/portfolio/priorities/` (TE-0006C) with `PortfolioObjective` ranking, or make a deliberate decision to keep them separate.
- Reconcile the two different materialLossPct threshold sets (-200 portfolio-level default vs. -100/-50 position-level, preserved for parity) into one, if that's ever desired — currently intentionally different, documented above.
- Wire `evaluatePortfolioObjectives` (portfolio-level batch) into any actual consumer — still has zero callers in the app.
- Surface `Position.portfolioObjective` in the UI (explicitly out of scope per PI-0002's "no new Portfolio UI" constraint).
