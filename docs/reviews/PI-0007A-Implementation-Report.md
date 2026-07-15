# PI-0007A — Recommendation Scorecard — Implementation Report

Branch: `feature/portfolio-intelligence`
Commit: `78c950c` (pushed to `origin/feature/portfolio-intelligence`)

## Executive summary

The intent-selection engine (`selectManagementIntent()`, introduced in PI-0006B) is now observable. Every score contribution is recorded at the exact `bump()` call site that adds it — stable id, human-readable label, signed point value, explanation, and source evidence field when known — instead of being reconstructed after the fact. `selectManagementIntent()`'s result now exposes the full ranked candidate list (every intent in the current context's relevant set that scored above zero, each carrying its own contributions and an `isWinner` flag), plus `winnerScore`, `runnerUpIntent`, `runnerUpScore`, `margin` (`winnerScore - runnerUpScore`), and a `confidenceTier` (`High` at margin ≥ 30, `Medium` at 15–29, `Low` below 15) derived only from the margin.

This is diagnostic-only, as the ticket requires. No score weight, baseline, relevant-intent set, tie-break order, trigger logic, threshold, label, or Rule ID changed. All 147 pre-existing `lib/portfolio-intelligence` tests pass unmodified, proving every PI-0006B decision is byte-for-byte preserved.

Position Intelligence gained a collapsed `Decision Scorecard` section, rendered only when `recommendation.managementIntent` is present, showing the winner, confidence tier, margin, and each ranked candidate with its score and contribution breakdown — visually secondary to the primary recommendation above it, consistent with the ticket's example format.

## Files changed

Modified:
- `lib/portfolio-intelligence/managementIntent.ts` — `bump()` now takes a structured contribution descriptor (`id`, `label`, `explanation`, optional `evidenceField`, optional `includeInReasons`) instead of a bare reason string, and records a `ScoreContribution` on the entry's `contributions` array at every call site. `ManagementIntentCandidate` gained `contributions: ScoreContribution[]` and `isWinner: boolean`. `ManagementIntentResult` gained `candidates` (the full ranked list), `winnerScore`, `runnerUpIntent`, `runnerUpScore`, `margin`, and `confidenceTier`. `intent`, `label`, `reasons`, and `alternatives` are computed by the exact same filter/sort/slice logic as before — untouched.
- `lib/portfolio-intelligence/index.ts` — exports the two new types, `ScoreContribution` and `ManagementIntentConfidenceTier`.
- `features/portfolio/intelligence/PositionIntelligencePanel.tsx` — added a `DecisionScorecard` component: a collapsed-by-default button/region pair (same disclosure pattern already used by `TodaysPriorities.tsx`) that renders winner/confidence/margin and the ranked candidate/contribution breakdown when expanded. Renders nothing when `managementIntent` is absent.

New:
- `lib/portfolio-intelligence/__tests__/recommendationScorecard.test.ts` — 21 tests: contribution sums, candidate sort order, excluded-intent checks, decision-margin/confidence-tier boundaries, and re-runs of the PI-0006B acceptance scenarios confirming the same winners.
- `docs/reviews/PI-0007A-Implementation-Report.md` — this report.

Modified (tests):
- `features/portfolio/intelligence/__tests__/PositionIntelligencePanel.test.tsx` — 4 new tests covering the scorecard's absent/collapsed/expanded/re-collapsed states.

## Design decisions

**`bump()` gets a contribution descriptor, not just a reason string.** Every one of the ~19 `bump()` call sites in `scoreCandidates()` now passes `{ id, label, explanation, evidenceField?, includeInReasons? }`. The `explanation` text is identical to the reason string PI-0006B already used at that call site, so `reasons` (which feeds the winning intent's user-facing supporting reasons) is byte-for-byte unchanged. A small number of "linked" bumps — e.g. a tight buffer's secondary +20 nudge to Cut Losses, which previously had no reason text of its own and was never added to `reasons` — now get `includeInReasons: false` so they're visible as scorecard contributions without altering the existing `reasons` output.

**Baselines get an explicit "Baseline" contribution.** Hold Position's +10 and Roll Position's +5 (when contextually relevant) were previously silent — no reason text at all. They now record a `Baseline` contribution (matching the ticket's own example) so the scorecard never shows an intent with a nonzero score and zero explanation.

**`candidates` is the same filter/sort as `alternatives`, just unsliced.** `RELEVANT_INTENTS[context].filter(score > 0).sort(...)` was already computed internally to derive `intent` and `alternatives` (capped at 3); PI-0007A exposes that same array in full as `candidates`, with `isWinner` set on the first element. No new filtering or sorting logic was introduced — this guarantees `candidates` can never include an intent outside the existing relevant-intent set, and can never disagree with `intent`/`alternatives` about ranking.

**Margin with no runner-up equals the winner's score.** `runnerUpScore` defaults to `0` when there's only one candidate (e.g. a lone baseline Hold in an `other-position` context with no other evidence), so `margin = winnerScore - 0 = winnerScore`. A lone baseline winner (score 10) therefore correctly reports `Low` confidence rather than an undefined or artificially `High` tier.

**Confidence tier is presentation-only.** `confidenceTierForMargin()` is a pure function of `margin` alone, called once after the winner/runner-up are already determined — it cannot feed back into which intent is selected.

## Acceptance scenarios

All five re-verified via `recommendationScorecard.test.ts`, run through `evaluatePositionObjective()` (not the selector in isolation):

| Scenario | Result |
|---|---|
| SOXL BPS | Still resolves to Hold Position / Cut Losses / Reduce Risk (never Roll); Roll Position still appears as a scored candidate, just doesn't win. |
| NVDA Wheel CSP | Still resolves to Accept Assignment or Hold Position; `candidates` contains only the five Wheel-CSP-relevant intents. |
| Profit Target | Still resolves to Take Profit; the winning candidate's contributions include the `profitTargetReached`-sourced entry. |
| Material Loss | Still resolves to Cut Losses; the winning candidate's contributions include the `materialLoss`-sourced entry. |
| Weak-Evidence Position | Hold Position wins on baseline alone, with `confidenceTier: 'Low'`. |

Decision-margin/confidence-tier boundaries were verified with exact scenarios (every score weight in this engine is a multiple of 5, so margins land on multiples of 5): margin 0 → Low, margin 10 → Low, margin 15 → Medium (lower boundary, inclusive), margin 20 → Medium, margin 30 → High (upper boundary, inclusive).

## Tests

381/381 pass across the full suite (147 `lib/portfolio-intelligence`, 127 `features/portfolio`, 107 `lib/autopilot` + `lib/decision-engine`), run in scoped batches due to the sandbox's per-command time limit. All 147 pre-existing `lib/portfolio-intelligence` tests pass with zero modifications, which is the direct proof that PI-0006B's recommendations are unchanged.

## TypeScript results

`tsc --noEmit`: clean, 0 errors.

## Build results

`next build` did not complete within this sandbox's execution window — consistent with the same environment constraint noted in the PI-0006A and PI-0006B reports (the process makes no meaningful progress within the sandbox's per-command time limit, not a code problem). TypeScript is clean and all test suites pass. Recommend treating the Vercel build on push as the authoritative build validation.

## Git state

Committed and pushed successfully this session: `78c950c` is on `origin/feature/portfolio-intelligence`, branch is up to date, working tree clean. No handoff steps required.

## Follow-up items

- Not manually smoke-tested against a live account/session. Recommend confirming after deploy: opening a position's Position Intelligence panel, expanding "Decision Scorecard," and checking that the winner/confidence/margin/candidate list match expectations for a few real positions (particularly one with a close margin, to confirm the `Low` confidence tier renders and reads sensibly next to a decisive recommendation).
