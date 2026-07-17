# PI-0008B — Decision Quality V1 — Implementation Report

Branch: `feature/portfolio-intelligence`

## Executive summary

This ticket centralizes every recommendation-weighting value used by `selectManagementIntent()` (the canonical intent selector behind every position recommendation) into one file, `lib/portfolio-intelligence/decisionQualityMatrix.ts`, and reweights several of them per the brief: Net Edge deterioration, technical trend running against a position, and gamma/DTE risk as expiration approaches now carry more influence; Health Score's one direct scoring input (a weak-health-confirmed loss) carries less, becoming supporting evidence rather than a dominant driver. Two of the brief's factors — Remaining Opportunity and earnings proximity — previously had zero or fixed-zero influence on any recommendation despite already being computed elsewhere in this codebase; both are now genuine, scaled scoring inputs for the first time. No new market data, indicators, APIs, or AI logic were introduced anywhere in this change, and no UI, Autopilot, or Position Intelligence layout code was touched.

## Files changed

New:
- `lib/portfolio-intelligence/decisionQualityMatrix.ts` — the centralized weight table, plus the shared `scaleWeight()`/`gammaDteFraction()` scaling helpers. Every constant carries a doc comment explaining what it does and, where changed, why.
- `lib/portfolio-intelligence/__tests__/decisionQualityMatrix.test.ts` — 18 new tests: scaling-helper unit tests, isolated tests for each new contribution (gamma/DTE, Remaining Opportunity, scaled earnings proximity), and the ticket's four validation scenarios.
- `docs/reviews/PI-0008B-Implementation-Report.md` — this report.

Modified:
- `lib/portfolio-intelligence/managementIntent.ts` — `scoreCandidates()` now reads every point value from the matrix instead of inline literals; three new contributions added (gamma/DTE risk, Remaining Opportunity, scaled earnings proximity); two new optional evidence fields (`remainingOpportunityPct`, `earningsProximityFraction`).
- `lib/portfolio-intelligence/objectives/positionObjective.ts` — computes `earningsProximityFraction` (reusing the already-computed `daysUntilEarnings`) and threads both new evidence fields into `ManagementIntentEvidence`. Added `remainingOpportunityPct` to `PositionObjectiveInput`.
- `app/portfolio/page.tsx` — `scorePortfolioPositionObjective()` now also computes `remainingOpportunityPct` via PI-0008A's existing `calculateRemainingOpportunity()` (the same inputs `scorePortfolioRemainingOpportunity` already assembles for the UI) and passes it into `evaluatePositionObjective()`.
- `lib/portfolio-intelligence/index.ts` — exports `DECISION_QUALITY_WEIGHTS` and its type.
- `lib/portfolio-intelligence/__tests__/recommendationScorecard.test.ts` — four exact-value tests recalculated against the new weights (see "Tests updated" below).

## The refactor: centralized Decision Quality Matrix

Before this ticket, every score adjustment in `scoreCandidates()` was an inline literal (100, 70, 60, 40, 30, 20, 15, 10, 5, 90) at its own `bump()` call site — no single place showed which weight was bigger than which, or why. `decisionQualityMatrix.ts` is now that one place: every value scoring reads is a named export, grouped by the signal it represents, with a doc comment. `managementIntent.ts` imports the table as `W` and reads `W.materialLoss`, `W.netEdgeDeclineReduceRisk`, etc. — the scoring *logic* (which `bump()` calls fire under which conditions) is unchanged; only where the numbers live, and several of the numbers themselves, changed. Future tuning is now a one-file change instead of a hunt across `bump()` calls.

## Reweighting decisions

| Signal | Old | New | Direction |
|---|---:|---:|---|
| Weak-health-confirmed loss (Cut Losses) | 70 | 55 | reduced — Health Score's one direct scoring input |
| Net Edge decline ≥25% (Reduce Risk) | 40 | 50 | increased |
| Net Edge negative (Reduce Risk / Cut Losses nudge) | 30 / 15 | 42 / 21 | increased |
| Technical trend against position (Cut Losses / Reduce Risk nudge) | 30 / 20 | 38 / 26 | increased |
| Technical trend aligned (Hold) | 30 | 30 | **unchanged**, deliberately (see below) |
| Tight/ITM buffer, Cut Losses nudge | 20 | 35 | increased (compounding-evidence fix, see below) |
| Material loss-stop breach (Cut Losses) | 100 | 100 | **unchanged**, deliberately (see below) |
| Gamma/DTE risk (Reduce Risk / Cut Losses) | n/a | new, scaled 0–15 / 0–8 | new |
| Remaining Opportunity (Take Profit / Reduce Risk / Hold) | n/a (computed but unused) | new, scaled | new |
| Earnings proximity (whichever intent leads) | fixed 0 | scaled 0–24 | increased |

**Material loss stays at 100, undiminished.** This is a real loss-stop policy breach, which the Decision Engine Constitution (Section IV.1, capital preservation; Section VIII.2, the hard-risk exception) requires to outrank everything else, including an explicit stated assignment preference. Reducing it would be "raw P/L as a primary driver" in name only — in substance it would weaken an existing, deliberate safety behavior this codebase already tested and relied on (`managementIntent.test.ts`'s "hard loss-policy breach still overrides assignment preference"). The brief's "reduce raw unrealized P/L" is satisfied instead by rebalancing the *softer* P/L-adjacent signal (weak-health-confirmed loss) and by giving forward-looking signals (Net Edge, trend, gamma, Remaining Opportunity) enough weight to change outcomes in the many gray-zone cases where P/L is moderate, not a hard breach — exactly the zone the existing SOXL-BPS regression tests already exercise with a flexible (Hold/Cut Losses/Reduce Risk) assertion.

**Technical trend's confirming direction (aligned → Hold) is deliberately left unchanged.** It previously sat at an exact score tie with the unprotected-profit Take Profit signal (40 vs. 10 baseline + 30). Any increase flips that tie for a reason unrelated to the position's own risk evidence — a profitable position with no working exit order should still resolve to protecting the gain, not to holding un-hedged, regardless of trend. Amplifying a "things are fine" signal also doesn't serve this ticket's actual goal (agreement with an experienced PM on cases that need attention); the against-trend direction, where the increase was applied, is where PM judgment and this reweighting actually matter.

**Reduce Risk vs. Cut Losses — the ticket's central compounding-evidence fix.** A single de-risking signal (one tight buffer, one declined net edge, one adverse trend) alone should support Reduce Risk, not an outright exit — that's this codebase's existing, deliberate distinction. But several severe signals compounding at once (a real loss-policy breach, a tight/ITM buffer, negative net edge, and an adverse trend, all together) is what an experienced PM would call Cut Losses, not "reduce risk a bit." Before this ticket, Reduce Risk's larger primary weights plus its secondary nudges to Cut Losses meant Reduce Risk almost always won even in the worst compounding cases (verified by hand-computing the ticket's own SOXL 17 DTE scenario against the old weights: Reduce Risk 60, Cut Losses only 20). Increasing the Cut Losses nudges (buffer 20→35, Net Edge negative 15→21) — while never letting any single nudge alone approach Cut Losses' dominant signals (100, 55, 38) — is what lets the compounding case correctly resolve to Cut Losses without ever letting one signal alone win it. See the validation scenario below.

## New factors

**Gamma/DTE risk.** Scales continuously from 0 at the existing 21-day management-window edge to a max at expiration, using the `dte` field every context already carries — no new evidence. The max (15 for Reduce Risk, 8 for Cut Losses) is deliberately capped so gamma alone cannot override Hold Position for a position with literally no other adverse evidence until DTE is genuinely low (the gamma-only Reduce Risk contribution crosses Hold's baseline right around the existing "critical expiration" 7-day convention already used elsewhere in this codebase, not at an arbitrary point).

**Remaining Opportunity.** PI-0008A built `calculateRemainingOpportunity()` as an explicitly parallel, independent metric with zero influence on any recommendation. This ticket is the first to consume it: low remaining opportunity (≤20%) now supports Take Profit on an already-profitable position (bank what's left) or Reduce Risk on a flat/losing one (little recoverable upside justifies less exposure — Cut Losses still requires its own harder evidence, so this never manufactures an exit signal from a derived metric alone). High remaining opportunity (≥70%) supports Hold Position — don't act prematurely on genuine upside. Wired through `app/portfolio/page.tsx` by computing it once per position from the same inputs already used for its Position Intelligence display.

**Earnings proximity.** Previously a fixed 0-point bump that only attached an explanatory reason to whichever intent already led. It now adds real, scaled weight to that same leader — closer proximity within the existing review window yields more weight — so earnings genuinely tips close contests instead of only narrating them. `positionObjective.ts` computes the proximity fraction from data it already has (`daysUntilEarnings`, the existing review-window policy value); `evaluatePortfolioObjectives.ts`'s boolean-only earnings signal falls back to a fixed moderate fraction (0.5), since it has no numeric date to compute proximity from — a documented, graceful degradation rather than losing the signal entirely.

## Position lifecycle

The brief lists "position lifecycle" among the factors to increase influence of. This codebase already expresses lifecycle at the intent-selection layer through `ManagementIntentContext` (`credit-spread` / `wheel-csp` / `covered-call` / `other-position` / `pending-order` / `idle-cash`) — the relevant-intent-set filtering, the Wheel/assignment-preference carve-out, and the context-specific relevant sets are all lifecycle-driven decisions that already exist and already gate which intents can even be considered. Rather than introduce a second, overlapping lifecycle taxonomy (the `RemainingOpportunityLifecycle` type PI-0008A introduced for a different purpose), this ticket increases lifecycle's influence through the compounding-evidence fix above, which context-gated signals (buffer, net edge, trend, gamma) feed into per context. A dedicated lifecycle-specific weight table is flagged as a possible follow-up if a future review finds today's context-based gating insufficient — not added here to avoid the complexity the brief explicitly warns against.

## Validation scenarios

All four exercised through `evaluatePositionObjective()` with hand-constructed, realistic evidence — no symbol-based branching exists anywhere in the engine; SOXL/AMD/NVDA are fixture labels only, matching this codebase's existing acceptance-scenario convention (see `managementIntent.test.ts`'s own SOXL/NVDA/AMD scenarios from earlier tickets).

1. **SOXL-style ~17 DTE Bull Put Spread, severe compounding evidence** (pnlPct -105%, buffer 1.5%, health 20, net edge declined 45% and negative, trend against): resolves to **Cut Losses** (score 196 vs. Reduce Risk's 181, margin 15). Confirmed this would have resolved to Reduce Risk under the pre-ticket weights (60 vs. 20) — a direct, hand-verified example of the ticket's intended change.
2. **SOXL-style ~38 DTE Bull Put Spread, healthy evidence** (pnlPct +12%, buffer 7%, health 85, no adverse net edge/trend): resolves to **Hold Position** (baseline only, no risk evidence inside the management window).
3. **AMD-style position, mixed/moderate evidence** (moderate loss, tight-ish buffer, watch-tier health, earnings inside the window): asserted for internal consistency only, per the ticket (contributions sum to each candidate's score, exactly one winner, winner never duplicated in alternatives, margin arithmetic holds) — not a specific intent.
4. **NVDA-style Wheel Cash Secured Put** (assignment preferred, healthy evidence): same internal-consistency assertions, plus confirmation that only Wheel-relevant intents ever appear as candidates.

## Tests

197 tests in `lib/portfolio-intelligence` (18 new), 130 in `features/portfolio`, 107 in `lib/decision-engine` + `lib/autopilot` — all passing. Run in scoped batches per this sandbox's per-command time limit, not test slowness.

**Tests updated (not newly written):** four exact-value assertions in `recommendationScorecard.test.ts` were recalculated against the new weights (technical-against-alone margin 10→12; net-edge-negative-alone margin 15→21; the weak-health-loss-vs-assignment-preference margin 20→35, moving from Medium to High confidence — a concrete demonstration of Health Score's reduced influence; net-edge-decline-alone margin 30→40). All four still land on the same tier category the original test demonstrated (Low/Medium/Medium/High respectively, except the health-score case which intentionally now demonstrates High instead of Medium — see the reweighting table above for why). No other existing test in the repository required a change; every other scenario either doesn't compete on the specific weights that moved, or already used a flexible (multi-intent) assertion that tolerates the new scores.

## TypeScript results

`tsc --noEmit`: clean, 0 errors.

## Build results

`next build` did not complete within this sandbox's execution window — the same environment constraint noted in every prior report in this series (background processes do not persist across sandbox calls here). TypeScript is clean and all test suites pass. Recommend treating the Vercel build on push as the authoritative build validation, per this project's established convention.

## Constraints honored

No AI logic, no new APIs, no new indicators, no UI redesign, no Autopilot changes, no Position Intelligence layout changes, no portfolio optimization, no machine learning. Every input consumed by the new scoring logic was already computed elsewhere in this codebase before this ticket.

## Follow-ups

- Not manually smoke-tested against a live account/session. Recommend confirming after deploy that recommendation labels for real positions still read sensibly, particularly for positions inside the 21-DTE window where gamma/DTE risk is now a live (if small) contributor.
- A dedicated lifecycle-specific weight table was considered and deliberately not built (see "Position lifecycle" above) — worth revisiting if a future product review finds today's context-based gating insufficient.
- `evaluatePortfolioObjectives.ts`'s per-position rules do not yet have `remainingOpportunityPct` wired through (that engine's earnings signal is also boolean-only, already falling back gracefully). Per the project's own prior documentation, this evaluator's per-position rules are not production-reachable today (Today's Priorities calls `evaluatePositionObjective()`, which is fully wired) — flagged rather than silently left inconsistent.
