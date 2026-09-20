# LEAPS-POS-0002 — Positions: the open-cycle card (a held LEAPS with a short call open)

**Status:** Approved by Dean 2026-09-20 ("go"); implemented — see the [implementation report](../implementation/LEAPS-POS-0002-implementation-report.md)
**Follows:** [LEAPS-POS-0001](./LEAPS-POS-0001-income-card.md). **Design:** Diane's mock, board 4. **Policy:** Ian's proposed defaults (editable).

## Problem

Once a call is sold against a held LEAPS, the Positions card only said "Monitor: a short call is already open". The weekly decision (hold, close or roll) had none of its numbers on screen.

## Scope

1. `lib/leaps-position-intelligence/cycleCard.ts` (pure): `buildCycleCard` and `CYCLE_CARD_POLICY`. Rules:

| Item | Rule |
|---|---|
| Premium captured | (sold − now) ÷ sold. **≥ 50%** = green, "past your review point"; negative = amber, "worth N% more than you sold it for" |
| DTE left | Amber at **≤ 21 days**: "roll-or-close window is open"; a "CLOSE OR ROLL WINDOW" chip appears on the card |
| Stock vs strike | Green with ≥ **3%** room; amber under 3% (with an early-assignment / ex-dividend note); **red** at or above the strike (in the money) |
| If assigned | (short strike − LEAPS strike − (entry cost − sold price)) × 100 × contracts, before fees |
| Breakeven floor | Short strike at or above the LEAPS breakeven = green; **below = red** ("an assignment would lock in a loss") |
| Long LEAPS | Value vs paid, breakeven vs stock (same rules as LEAPS-POS-0001), net delta kept (long − short), income so far (sold − cost to close, × 100 × contracts) |

2. Model: a long LEAPS with `pairedShortCallKey` now also carries the paired short call's own facts (strike, expiration, DTE, contracts, sold price, current price, delta) as `pairedShort`; left out when the structure is unusual, in which case the existing Monitor explanation shows.
3. Positions card: when `pairedShort` is present, shows "Short call since you sold it" and "Your LEAPS" tiles plus callouts; the Monitor sentences move under Details. State label and buttons are unchanged. `incomeCard.ts` exports its two shared long-LEAPS tiles for reuse.

## Non-goals

- No close / roll buttons on the card yet: those hand off to the existing close and roll flows and need the short position's handlers, which the card does not receive. Use the position rows' existing actions.
- "Income vs extrinsic lost" (in the mock) needs the stock price and LEAPS price at entry, which the broker snapshot does not carry; it becomes possible with entry snapshots. "Income so far" is shown instead.
- No earnings / ex-dividend dates, no saved mandate, no change to how the state is decided.

## Acceptance criteria

1. Every tile, tone and callout above is pinned by unit tests including each threshold boundary (50% / just under, 22 / 21 days, 3% room, stock at and above the strike, strike at breakeven / below), losses, missing sold price / entry cost / stock price / deltas, multiple contracts, purity.
2. The model carries `pairedShort` from the paired short position, using the absolute delta (pinned by a model test that fails without the builder change).
3. Existing Positions behavior and tests are unchanged.

## Rollout notes

No flag or environment variable. Rollback is a revert.
