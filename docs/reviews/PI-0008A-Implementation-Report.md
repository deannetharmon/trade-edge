# PI-0008A — Remaining Opportunity Engine — Implementation Report

Branch: `feature/portfolio-intelligence`
Commit: `cd77046` (pushed to `origin/feature/portfolio-intelligence`, on top of `78c950c`)

## Executive summary

Portfolio Intelligence now computes two deterministic, existing-metrics-only measurements for any open position with a credit basis: **Opportunity Captured (%)** — how much of the original credit has already been realized as profit — and **Remaining Opportunity (%)** — how much of the position's economic upside genuinely remains, discounted by the same risk and time signals the rest of the codebase already tracks.

This is explicitly not a Decision Engine change. `calculateRemainingOpportunity()` is a parallel, independent calculation: it does not feed `selectManagementIntent()`, is not read by `evaluatePositionObjective()`'s trigger-detection branches, and changes no score weight, threshold, or recommendation anywhere. It answers a different question than the existing engine does — "how much upside is left?" instead of "what should I do?" — using only data Portfolio Intelligence already has on hand.

Both percentages now render in Position Intelligence, in a new always-visible "Remaining Opportunity" section directly below the current recommendation.

## Files changed

New:
- `lib/portfolio-intelligence/remainingOpportunity.ts` — the calculator, `calculateRemainingOpportunity()`.
- `lib/portfolio-intelligence/__tests__/remainingOpportunity.test.ts` — 14 tests covering the five required scenarios plus edge cases and determinism/bounds checks.
- `docs/reviews/PI-0008A-Implementation-Report.md` — this report.

Modified:
- `lib/portfolio-intelligence/objectives/positionObjective.ts` — exported three previously module-private pure helpers (`daysUntil`, `isUpcomingBeforeExpiration`, `normalizePositionObjectivePct`) so the new module can reuse the exact same date math and pnlPct/buffer normalization instead of duplicating it. No behavior change to any existing branch — these are pure utility functions, not part of the trigger-detection or scoring logic.
- `lib/portfolio-intelligence/index.ts` — exports `calculateRemainingOpportunity` and its types, plus the newly-exported `normalizePositionObjectivePct`.
- `app/portfolio/page.tsx` — extracted the existing net-edge evidence computation (previously inline in `scorePortfolioPositionObjective`) into a shared `computeNetEdgeEvidence()` helper, reused by a new `scorePortfolioRemainingOpportunity()` function that calls the calculator at the same render call site `classifyPositionLifecycle(pos)` already runs at. Nothing is persisted onto `Position` — this is computed fresh at render time, matching the existing pattern.
- `features/portfolio/intelligence/PositionIntelligencePanel.tsx` — new optional `remainingOpportunity` prop and a new "Remaining Opportunity" section, rendered only when both the prop and its percentage are present.
- `features/portfolio/intelligence/__tests__/PositionIntelligencePanel.test.tsx` — 3 new tests (absent, null, and populated states).

## Design decisions

**Every factor reuses an existing threshold — nothing new was invented.** This was the ticket's core constraint ("reuse existing portfolio metrics," "do not add new signals"), so each discount factor is traceable to a convention that already exists elsewhere in this codebase:

| Factor | Formula | Reused from |
|---|---|---|
| Time | `clamp(dte / 21, 0, 1)` | `DEFAULT_POSITION_MANAGEMENT_POLICY.dteReviewThreshold` |
| Health | `clamp(healthScore / 100, 0, 1)` | health score's own existing 0–100 scale |
| Buffer | `clamp(buffer / 5, 0, 1)` | health/score.ts's own "buffer ≥ 5% = comfortable" band |
| Loss drag | `clamp(1 + pnlPct / 100, 0, 1)` | `DEFAULT_POSITION_MANAGEMENT_POLICY.materialLossPct` (-100, the existing "1x credit loss" convention) |
| Net edge | 0.85 if negative, 0.9 if declined ≥25% from peak | managementIntent.ts's exact REDUCE_RISK thresholds |
| Earnings | 0.85 if inside the review window | `earningsReviewWindowDays` + the exported `daysUntil`/`isUpcomingBeforeExpiration` helpers |

**Opportunity Captured is the anchor, not a separate calculation.** `capturedPct = clamp(pnlPct, 0, 100)` — this codebase's existing %-of-credit convention already expresses "how much of the credit has been realized" directly (the same value the profit-target trigger at 50% already reads), so no new formula was needed for this half of the ticket.

**Factors combine multiplicatively, not by averaging.** An early design considered averaging the four graduated factors (time/health/buffer/loss-drag), but that washed out the effect of any single weak signal — a losing position with weak health scored a counterintuitively high 70% remaining opportunity under an averaged model. Multiplying the factors instead means each one is treated as an independent "confidence that the theoretical remainder is genuinely capturable" discount, so a losing spread with weak health correctly shows 16% remaining (not 70%), and a position 3 DTE from expiration correctly shows ~12% remaining regardless of a healthy paper P/L. This directly serves the ticket's stated goal of moving away from a fixed profit-target view toward a genuinely risk-aware opportunity estimate.

**"Position lifecycle" maps to the existing structural classifier already used by Position Intelligence.** `classifyPositionLifecycle(pos).type` (SPREAD/CSP/COVERED_CALL/ASSIGNED_STOCK/PMCC/UNKNOWN) is already computed at the exact render call site this feature hooks into — reusing it required zero new plumbing. `ASSIGNED_STOCK` is treated as a clean edge case: an assigned position has already converted, so its original option-based opportunity is fully resolved (100% captured, 0% remaining) rather than showing a stale, still-open-looking percentage.

**No credit basis means "not applicable," not zero.** When `creditReceived` is absent or non-positive, both percentages return `null` and the UI section simply doesn't render — consistent with this codebase's existing philosophy elsewhere (e.g. `netEdgeLive` returning `null` rather than fabricating a value from incomplete data).

## Required test scenarios

All five from the ticket, each hand-verified against the documented formula before running:

| Scenario | Captured | Remaining | Why |
|---|---|---|---|
| Winning spread | 60% | 40% | Healthy on every factor (30 DTE, 10% buffer, 100 health) — no discount applied. |
| Losing spread | 0% | 16% | Weak health (40) and active loss (-60%) compound: `100 × 0.4 × 0.4 = 16`. |
| Early lifecycle | 10% | 81% | 45 DTE keeps the time factor at its ceiling; only health (90) discounts. |
| Late lifecycle | 10% | 12% | 3 DTE drives the time factor to `3/21 ≈ 0.14`, dominating even with healthy P/L. |
| Wheel CSP | 30% | 38% | CSP lifecycle at 15 DTE, 75 health: `70 × (15/21) × 0.75 = 37.5 → 38`. |

Additional coverage: the ASSIGNED_STOCK edge case (100%/0%), no-credit-basis nulls, isolated net-edge and earnings haircuts, purity (identical input → identical output), and bounds (never outside [0, 100] even with absurd or negative inputs).

## Tests

398/398 pass across the full suite: 161 `lib/portfolio-intelligence` (including the 14 new Remaining Opportunity tests), 130 `features/portfolio` (including 3 new Position Intelligence tests), 107 `lib/autopilot` + `lib/decision-engine`. Run in scoped batches due to the sandbox's per-command time limit, not test slowness.

## TypeScript results

`tsc --noEmit`: clean, 0 errors.

## Build results

`next build` did not complete within this sandbox's execution window — the same environment constraint noted in every prior report in this series (the process makes no meaningful progress within the sandbox's per-command time limit, not a code problem). TypeScript is clean and all test suites pass. Recommend treating the Vercel build on push as the authoritative build validation.

## Git state

Committed and pushed successfully: `cd77046` is on `origin/feature/portfolio-intelligence` (confirmed via your own push — rebase was a no-op since origin hadn't moved). Branch is up to date, working tree clean.

## Follow-up items

- Not manually smoke-tested against a live account/session. Recommend confirming after deploy: opening Position Intelligence for a real winning position, a real losing position, and a real CSP, and checking that the two new percentages read sensibly next to the existing recommendation and Decision Scorecard.
- The multiplicative combination is a deliberate design choice (see "Design decisions" above) but is inherently more aggressive than an averaged model when multiple weak factors coincide — worth a product review once real position data is visible, in case the compounding feels too punishing or not punishing enough in practice.
