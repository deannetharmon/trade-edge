# LEAPS-DASH-0003 — LEAPS Advisor picks as dashboard cards (rule-computed)

**Status:** Approved by Dean 2026-09-20 ("go"); implemented — see the [implementation report](../implementation/LEAPS-DASH-0003-implementation-report.md)
**Design:** Diane's dashboard mock, board 2 (revision 2). **Policy:** Ian.

## Problem

After Get Recommendation the advisor showed a wall of AI text per pick, and a conversation block repeating it. The picks were hard to compare at a glance.

## Scope

1. `lib/leaps-analysis/dashboard.ts`: `buildLeapsPickSummary` (five tiles and rule callouts per pick), `sortPicksByScore`, `buildConcentrationCallout`, and one new policy value `highDeltaMin` (0.80). It reuses the thresholds from LEAPS-DASH-0001 (extrinsic ≤ 15% of cost, spread > 5%) and the PMCC start estimate.
2. `features/screener/components/LeapsAdvisorPickCard.tsx`: score badge, readable contract label, five tiles (Delta, DTE, Extrinsic, Spread, PMCC start), callout pills, **Verify before trading**, and the advisor's reasoning collapsed under "Why the advisor picked this". `CalloutList` is shared with the analysis dashboard.
3. `app/screener/page.tsx`: picks are ordered by TradeEdge score (unscored last, ties keep the advisor's order). The advisor's summary, sizing note and conversation move into one collapsed "Advisor's notes and conversation" block that opens itself once you ask a follow-up. A concentration callout is computed in code. The panel now receives the trader's own PMCC short-call settings.

## Rules

| Item | Rule |
|---|---|
| Score badge | The candidate's TradeEdge score, from the scan |
| Order | Highest score first; the AI's own ordering no longer decides |
| High delta | Delta ≥ 0.80: "moves closely with the stock" (good) |
| Extrinsic | ≤ 15% of cost: good "little time value at risk"; above: watch |
| Spread | > 5%: watch, with dollars to cross |
| PMCC start | Above: good; below: watch with the rise needed; no IVx: dash, no callout |
| Concentration | 2+ picks in one or two companies: watch callout |

## Non-goals

- No change to the advisor route, its prompt, or which picks the AI selects (the advisor stays frozen per decision D2).
- Covered Call and PMCC advisors, and the Positions cards, are separate tickets.

## Acceptance criteria

1. Tiles, tones, callouts, ordering and the concentration rule are pinned by unit tests, including the delta 0.79 / 0.80 and extrinsic 15% boundaries and the trader's own PMCC settings changing the PMCC tile.
2. A pick whose contract is no longer in the filtered results still shows (label and reasoning) with Verify disabled.
3. Missing quote data shows dashes, never guesses.
4. The AI's reasoning, summary, sizing note and conversation are collapsed by default.

## Rollout notes

No flag or environment variable. Rollback is a revert.
