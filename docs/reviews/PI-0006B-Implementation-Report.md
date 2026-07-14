# PI-0006B — Intent-Based Recommendation Engine — Implementation Report

Branch: `feature/portfolio-intelligence`
Built on: `8df2747` (PI-0006A) + `3f50bf7` (spec doc from origin — see "Git state" below)

## Executive summary

Portfolio Intelligence no longer picks a label per trigger ("roll-soon" → "Roll Position"). It now runs every position/order/cash rule's evidence through one canonical evidence-based selector — `selectManagementIntent()` — that scores all eight canonical management intents (Hold Position, Take Profit, Cut Losses, Reduce Risk, Roll Position, Accept Assignment, Replace Working Order, Deploy Idle Cash) against only the evidence relevant to that position's context, and returns exactly one winner plus its supporting reasons and runner-up alternatives.

This replaces PI-0006A's static per-kind label table with a real decision: a DTE-driven "roll-soon" trigger no longer automatically labels itself "Roll Position" — Roll only wins when there's roll-specific evidence (an explicit `roll_review` flag). A tight-buffer position with a large loss doesn't get lumped into a single "Exit Position" bucket — it resolves to Cut Losses, Reduce Risk, or Accept Assignment depending on whether it's a real loss-stop breach, a de-risking situation short of a full exit, or a Wheel position where assignment is the stated goal.

As before, this is additive: `kind`, `ruleId`, `type`, priority/urgency/actionability, and every trigger threshold are unchanged. Only the decisive `label`/`title` (now intent-driven), the evidence bullets (now intent reasons first), and two impact-text branches changed.

## Files changed

New:
- `lib/portfolio-intelligence/managementIntent.ts` — the canonical intent type, label map, relevant-intent-set table, evidence-based scorer, and `selectManagementIntent()`. See "Design decisions" below for the scoring rationale.
- `lib/portfolio-intelligence/__tests__/managementIntent.test.ts` — unit tests on the selector (relevant-intent-set filtering, "Roll must earn it," strategy-awareness/hard-risk-exception) plus all five ticket acceptance scenarios, exercised through the real producers.
- `docs/reviews/PI-0006B-Implementation-Report.md` — this report.

Modified:
- `lib/portfolio-intelligence/types.ts` — added `managementIntent?: ManagementIntentResult` to `PortfolioObjective` (optional; `REDUCE_CONCENTRATION`, `PRESERVE_BUYING_POWER`, `INCREASE_INCOME`, `WAIT` don't set it — none are part of the ticket's 8-intent vocabulary).
- `lib/portfolio-intelligence/objectives/positionObjective.ts` — replaced PI-0006A's static `LABEL_BY_KIND` lookup with `classifyIntentContext()` (maps a position's strategy/positionStrategy to a relevant-intent-set context) and a call to `selectManagementIntent()`; `label`/`title` now come from the winning intent; the trigger-detection if/else chain (which branch fires, at what urgency/confidence) is untouched. `PositionObjectiveInput` gained optional evidence fields (`managementFlags`, `netEdgeDeclinePct`, `netEdgeNegative`, `technicalAlignment`) that feed the selector without changing any existing trigger condition. `buildPortfolioAndIncomeImpact()` gained one new branch: `assignment-risk` + `ACCEPT_ASSIGNMENT` now describes assignment as the stated goal instead of an unplanned risk.
- `lib/portfolio-intelligence/evaluatePortfolioObjectives.ts` — every position/order/cash rule (`evaluateThreatenedPosition`, `evaluateDteManagement`, `evaluateCloseForProfit`, `evaluateDeployIdleCash`, `evaluatePendingOrder`) now calls `selectManagementIntent()` and uses the winning label for its title, with the intent's reasons prepended to `supportingEvidence`. `evaluateDteManagement`'s `type`/`ruleId` now follow the selected intent (`ROLL_POSITION`/`OBJ-ROLL-POSITION` only when Roll actually wins) rather than a hardcoded flag check. `evaluateConcentration`, `evaluatePreserveBuyingPower`, `evaluateIncreaseIncome` are untouched — portfolio-level, outside the 8-intent vocabulary.
- `app/portfolio/page.tsx` — `scorePortfolioPositionObjective()` now computes `netEdgeDeclinePct`/`netEdgeNegative` from the position's own `netEdgeLive`/`netEdgePeak` (both already defined in this file, and synchronous at this call site since `snapshotHistory` is attached before this function runs) and passes them into `evaluatePositionObjective()`. `technicalAlignment` is intentionally **not** wired in this slice — see "Follow-ups."
- `lib/portfolio-intelligence/index.ts` — exports `selectManagementIntent`, `MANAGEMENT_INTENT_LABEL`, and the `ManagementIntent`/`ManagementIntentCandidate`/`ManagementIntentContext`/`ManagementIntentEvidence`/`ManagementIntentResult`/`TechnicalAlignment` types.
- `lib/portfolio-intelligence/__tests__/positionObjective.test.ts` — one label assertion updated (`'Exit Position'` → `'Reduce Risk'`, since that fixture — tight/ITM buffer, no material loss, no roll evidence — is now Reduce Risk evidence rather than a generic exit).

## Design decisions

**Scoring, not another lookup table.** Each candidate intent accumulates small integer points per confirmed signal (same "factor → scoreImpact" pattern `health/factors.ts` already uses): a material loss adds 100 to Cut Losses, a tight/ITM buffer adds 60 to Reduce Risk (and 20 to Cut Losses), an explicit `roll_review` flag adds 100 to Roll, assignment preference on a Wheel adds 90 to Accept Assignment, and so on. Hold Position always carries a baseline of 10, and Roll Position carries a baseline of 5 wherever it's contextually relevant — enough that Hold wins by default when evidence is genuinely weak, and Roll always shows up as a considered alternative without ever winning on baseline alone.

**"Roll must earn it" is structural, not a rule.** `dte` is accepted into `ManagementIntentEvidence` for bookkeeping but is never read by the scorer. The only thing that can push Roll's score above its 5-point baseline is `rollFlagged` (an explicit `roll_review` management flag) — the one form of roll-specific evidence this codebase has today. There is no path by which "17 DTE" alone produces a Roll win.

**Relevant intent sets gate the candidate pool, not just the display.** `RELEVANT_INTENTS` (keyed by `credit-spread` / `wheel-csp` / `covered-call` / `other-position` / `pending-order` / `idle-cash`) filters which intents are even scored — an idle-cash rule is structurally incapable of returning Cut Losses no matter what evidence is passed in, since Cut Losses isn't in that context's candidate list at all.

**Strategy-awareness carve-out (ticket #7).** Assignment preference/intent only bumps Accept Assignment for Wheel/covered-call contexts, and never suppresses a real loss-stop breach — `materialLoss` (100 points) outscores the assignment-preference bump (90 points) by design, so the NVDA-style "Wheel with assignment preferred" case still resolves to Cut Losses if a hard loss-policy breach is genuinely present (the ticket's own "unless a hard-risk policy requires it" exception), and to Accept Assignment otherwise.

**Earnings never gets its own intent.** An actionable earnings window (inside `earningsReviewWindowDays`) adds an explanatory reason to whichever intent is already leading — it raises the stakes on the existing decision rather than substituting a generic "review earnings" outcome. Outside the window, no reason or boost is added at all (the objective is still produced, per PI-0004B's existing actionability gating, just tagged `MONITOR`).

**`kind`/`ruleId`/`type` untouched in `positionObjective.ts`.** Exactly as in PI-0006A: the trigger-detection chain, thresholds, and stable identifiers are byte-for-byte the same. Only the label/title and two `buildPortfolioAndIncomeImpact` branches changed. In `evaluatePortfolioObjectives.ts`'s `evaluateDteManagement`, `type`/`ruleId` do now follow the selected intent (Roll vs. plain management) rather than the old hardcoded-flag check — this was necessary because that function's own `ROLL_POSITION` type was previously gated on the same flag the intent selector also uses, so switching it to read the selector's decision is a like-for-like swap, not new logic.

## Acceptance scenarios

All five are covered by regression tests in `managementIntent.test.ts`, run through the actual producers (not just the selector in isolation):

| Scenario | Result |
|---|---|
| SOXL BPS (~17 DTE, large net-edge decline, weak technical, moderate loss, no roll evidence) | Resolves to **Reduce Risk** (net-edge decline + adverse technical trend outscore the Roll/Hold baselines); Roll never wins. |
| NVDA Wheel CSP (Wheel, assignment preferred, concentration elevated) | Resolves to **Accept Assignment**; still resolves to **Cut Losses** if a material loss is also present (hard-risk exception). Portfolio-level concentration awareness (`evaluateConcentration`'s Wheel-managed branch) is untouched and still fires. |
| AMD Earnings | Outside the review window: defaults to Hold, no earnings-specific reason attached, `actionability: MONITOR` (existing PI-0004B behavior). Inside the window with supporting evidence (tight buffer): resolves to **Reduce Risk** with an earnings-specific reason appended — never a generic "Review Earnings Plan." |
| Profit Target | **Take Profit** wins in both `evaluatePositionObjective` (via `hitTarget`) and `evaluatePortfolioObjectives` (via `pctOfMaxProfitCaptured`). |
| Material Loss | **Cut Losses** wins in both producers when the loss-stop policy is breached, including against a same-position Wheel/assignment-preferred bump. |

## Tests

All 126 tests in `lib/portfolio-intelligence` pass, including the 17 new tests in `managementIntent.test.ts` (unit tests on the selector plus all five acceptance scenarios). Also re-ran `features/portfolio/**` (123 tests, all UI consumers of `recommendation`/`objective`) and `lib/autopilot` + `lib/decision-engine` (107 tests, unrelated but exercised for safety) — all green, confirming nothing outside `lib/portfolio-intelligence` broke. Run in scoped batches due to the sandbox's per-command time limit, not test slowness. One label assertion in the existing `positionObjective.test.ts` was updated to reflect the new evidence-driven label (see "Files changed").

## TypeScript results

`tsc --noEmit`: clean, 0 errors.

## Build results

`next build` did not complete in this sandbox within the per-command time limit (same environment constraint noted in the PI-0006A report — the process makes no meaningful progress within the sandbox's execution window, not a code problem). TypeScript is clean and all test suites pass. Recommend treating the Vercel build on push as the authoritative build validation.

## Follow-up items

- **`technicalAlignment` is accepted but not wired end-to-end.** `ManagementIntentEvidence.technicalAlignment` and `PositionObjectiveInput.technicalAlignment` both exist and the selector reacts to them (adverse trend → Cut Losses/Reduce Risk; aligned trend → reinforces Hold), but `app/portfolio/page.tsx` doesn't yet pass a value through. The existing trend computation (`getTrend`/`TrendResult`) is fetched asynchronously per-card and isn't available at `scorePortfolioPositionObjective`'s synchronous call site. A future slice could either make that call site async or precompute trend alongside `attachSnapshotHistory`.
- **`evaluatePortfolioObjectives.ts`'s batch evaluator doesn't yet pass net-edge or technical evidence into the selector** — `PortfolioPositionInput` (the batch/Today's-Priorities input shape) has no equivalent fields today. `evaluateThreatenedPosition`/`evaluateDteManagement` currently only feed the selector `dte`, `pnlPct`, `materialLoss`, `earningsActionable`, `rollFlagged`, and assignment/strategy fields. Extending `PortfolioPositionInput` with the same net-edge/technical fields `positionObjective.ts` now has, and wiring them from whatever adapter feeds this batch path, would let the SOXL-style scenario resolve identically from both entry points.
- **`managementFlags` has no source in `app/portfolio/page.tsx`'s `Position` model.** `rollFlagged`/`roll_review` is accepted by both producers, but nothing in the Portfolio page today sets a `managementFlags` array on a position — Roll therefore can only win in this codebase today via whatever future feature sets that flag (e.g. a "flag for roll review" UI action), not from any existing production data path.
- **Impact-text rewrite deferred.** Per-kind `buildPortfolioAndIncomeImpact` text is still keyed off the legacy `kind`, with one new branch added for `ACCEPT_ASSIGNMENT`. A fuller pass that keys every impact statement off the winning `ManagementIntent` instead of `kind` would be more consistent but is broader than this ticket's scope.
- Confirm the Vercel build succeeds for `feature/portfolio-intelligence`, since the local build couldn't be validated in this sandbox.
- Not manually smoke-tested against a live account/session. Recommend confirming after deploy: Today's Priorities and the Position Intelligence panel show intent-driven labels that vary by evidence (e.g. the same DTE trigger showing "Reduce Risk" for one position and "Hold Position" for another, rather than both always showing the same generic label).

## Git state — please reconcile before merging

This session hit a persistent sandbox filesystem issue (`EPERM` on `.git/*.lock` files) that made it unsafe to run git write operations from here, so **no commits were made this session** — all changes above exist only in the working tree of the folder connected to this session. Separately, `git fetch` showed `origin/feature/portfolio-intelligence` had already advanced past this session's local branch tip (to `3f50bf7`, adding the `planning/PI-0006B_INTENT_BASED_RECOMMENDATION_ENGINE.md` spec doc itself) — that divergence was not resolved at the git-history level, only the one file's content was pulled into the working tree.

From your own terminal, from the repo root:
```bash
git status
git add -A
git commit -m "feat: PI-0006B intent-based recommendation engine"
git fetch origin
git log --oneline feature/portfolio-intelligence..origin/feature/portfolio-intelligence
git push origin feature/portfolio-intelligence
```
If the fetch shows origin has commits this branch doesn't (it should, per the note above), rebase or merge before pushing rather than force-pushing over them.
