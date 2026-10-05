# TAKEPROFIT-BASIS-0001 — Take Profit only on a capturable profit; "Set Profit Target" at 20%

## Status

**IMPLEMENTED 2026-10-05 — pending CI and Vercel preview.** Ian (approve with changes), Paul (scope), Quinn (with conditions), Dean. Note: the false SOXL "Take Profit" itself was a units bug, fixed separately in PCT-UNITS-0001; this ticket fixes the rule's basis, label and stability.

## Problem

A SOXL short put showed "Take Profit: Position has meaningful profit but no working profit-target order" while it was -$10 at close-now and +$5 at mid. A refresh replaced it with Hold.

Two rules can say Take Profit (`lib/portfolio-intelligence/objectives/positionObjective.ts`):

| Rule | Fires when | Close-now check |
|---|---|---|
| Profit target reached (~902-909) | mid P/L >= 50% of credit, or the position's target hit | Yes |
| Unprotected profit (~929-930) | mid P/L >= 20% of credit, no working target order, DTE > 14 | **No** |

The 20% rule reads as "close now" although its purpose is "protect the profit with a target order".

## Scope (Ian's rulings)

1. **Capturable profit.** The 20% rule also requires close-now (marketable) P/L > 0 (PI-0014's `marketablePnlPct`).
2. **Rename.** The 20% rule becomes its own recommendation, **"Set Profit Target"**, informational weight (calm, no colour), suggested action Set/Edit Profit Target. "Take Profit" remains only for the 50% rule confirmed at close-now.
3. **No flip-flopping.** A recommendation changes only when the new condition holds on two consecutive refreshes (both directions), using the previous result already passed to `attachSnapshotHistory` (`previousByKey`). On a fresh page load (no previous result) show the new result marked "pending confirmation".
4. **Explain the number.** The reason line states what the rule acted on: "Up 22% of credit at mid (close-now: +3%) · no profit-target order · as of 10:42 ET". Show both bases when they disagree.

**Out:** threshold changes (20%, 50%, 14 DTE, 21 DTE unchanged); Cut Losses buttons on Acquire positions (DECIDE-0001 S3-0); GTC-REPLACE-0001.

## Quinn's conditions

- "Set Profit Target" is a new recommendation kind, not a relabel: check every list and ordering of kinds (`canonicalRecommendationPriority`, `canonicalRecommendationToAction`, dashboard priorities, briefing).
- `lib/portfolio-intelligence/__tests__/recommendationScorecard.test.ts` (~104) expects TAKE_PROFIT for the 20% rule and must be updated; expect others. Full suite before push.
- Golden fixtures (Alan): mid 22% / close-now -4% → no prompt; mid 22% / close-now +3% → Set Profit Target (informational); mid 55% confirmed at close-now → Take Profit; change appears only on the second matching refresh, both directions; reason text includes basis and as-of time.

## As built

- **New intent `SET_PROFIT_TARGET`** ("Set Profit Target", `lib/portfolio-intelligence/managementIntent.ts`): the unprotected-profit evidence now scores it instead of TAKE_PROFIT. Same weight, so it wins the same ties TAKE_PROFIT did; tie order right after TAKE_PROFIT; priority urgency 0.5 (`lib/priorityScore/config.ts`), below Take Profit 0.85. The legacy kind was already `place-gtc` ("Place or verify a profit-target GTC order"); the label shown comes from the intent.
- **Capturable profit:** `meaningfulUnprotectedProfit` also requires close-now (marketable) P/L > 0 when a close-now reading exists (`positionObjective.ts`).
- **Reason line states the numbers:** "Up 22% of credit at mid (close-now: +18%) · no profit-target order." (`describeUnprotectedProfit`), in both the intent reason and the legacy primary reason.
- **Informational tone** in the Positions table (`PositionsWorkspace.tsx` `recommendationTone`), not green.
- **No flip-flopping:** `lib/portfolio-data/recommendationHysteresis.ts`, applied in `attachSnapshotHistory`. A changed recommendation shows only when a second consecutive refresh confirms it, both directions; the pending one is kept on `Position.recommendationPending`.
- Tests: `recommendationHysteresis.test.ts` (8), `percentUnits.test.ts` (SET_PROFIT_TARGET and reason text), `recommendationScorecard.test.ts` (updated tie-break). Full suite 474 files / 6,832 tests; TypeScript check clean.

## Deviations for Ian to confirm

1. **Close-now unknown:** the Set Profit Target nudge still shows when no close-now reading exists (it only suggests placing a target order, never closing). With a close-now reading it must be positive.
2. **Urgent changes are not delayed:** a change TO cut losses, assignment risk, earnings risk or verify pricing shows at once. Leaving one still needs the second refresh, so one favourable tick cannot clear an alert.
3. **First page load shows results as computed**, not marked "pending confirmation": marking every position pending on each load would be noise. Stability applies from the second refresh on.
4. **No per-row "as of" time:** the page header now shows "Updated N min ago" (PORTFOLIO-AUTOREFRESH-0001), which covers every row.
