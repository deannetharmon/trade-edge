# LEAPS-DASH-0004 — Covered Call and PMCC advisor picks as dashboard cards

**Status:** Approved by Dean 2026-09-20 ("do any of them"); implemented — see the [implementation report](../implementation/LEAPS-DASH-0004-implementation-report.md)
**Follows:** [LEAPS-DASH-0003](./LEAPS-DASH-0003-advisor-cards.md) (same treatment for the LEAPS Advisor)

## Problem

After Get Recommendation on a Covered Call or PMCC scan, each pick was a paragraph of AI text, and the summary, sizing note and conversation repeated it.

## Scope

1. `lib/scans/advisorCards.ts` (pure): `buildCcPickSummary` and `buildPmccPickSummary` produce five tiles and rule-based callouts from the scan result the pick refers to; `ADVISOR_CARD_POLICY` (3% near-strike band, 5% spread threshold, the same values used elsewhere).

| Strategy | Tiles | Callouts |
|---|---|---|
| Covered Call | Premium, Yield / yr, Delta, DTE, Room to strike | Strike above your cost basis (green) / **below it (red: assignment locks in a loss)**; strike at or below the stock (red, in the money); stock within 3% of the strike (amber) |
| PMCC | Credit (per contract), Short Δ, Short DTE, Debit / width, Spread | Max profit at the short strike = width less net debit (green; red if none); spread above 5% (amber); short strike at or below the stock (red) or within 3% (amber) |

2. `AdvisorPanel` (Covered Call and PMCC) shows one card per pick (readable contract label from LEAPS-UI-0004, tiles, callout pills, the advisor's reasoning collapsed under "Why the advisor picked this"), a computed concentration note, and the summary / sizing note / conversation collapsed into one block that opens itself after a follow-up. The parent supplies each pick's numbers from the scan result it already holds.
3. The pick card is shared with the LEAPS advisor: the score badge and the Verify button are optional (these advisors have neither).

## Also included: test timeout (flake protection)

One Screener-page test (`CcCapacityGate`) failed once in a heavy parallel run and passed on every rerun. `vitest.config.ts` now sets `testTimeout: 20_000` (the default is 5 s) so machine load on a busy CI runner does not look like a real failure. It only raises the limit; tests that genuinely fail still fail. The exact cause of that one failure was not captured, so this is a precaution, not a confirmed fix.

## Non-goals

- No change to either advisor's route, prompt, or which picks the AI selects (the advisors stay frozen per decision D2). Picks stay in the advisor's order: the Covered Call and PMCC results have no single comparable score to order by.
- The picks' payload sent to the AI is unchanged.

## Acceptance criteria

1. Every tile, tone, callout and boundary in the table (3% band, 5% spread, cost-basis sign, max-profit sign, missing data) is pinned by unit tests.
2. A pick whose result is no longer in the filtered list still shows its label and the advisor's reasoning, without tiles.
3. Missing data shows dashes, never guesses.

## Rollout notes

No flag or environment variable. Rollback is a revert.
