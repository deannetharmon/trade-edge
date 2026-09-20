# LEAPS-POS-0001 — Positions: the held-LEAPS "PMCC income" card as a dashboard (v1, read-only)

**Status:** Approved by Dean 2026-09-20 ("continue with the next option"); implemented — see the [implementation report](../implementation/LEAPS-POS-0001-implementation-report.md)
**Design:** Diane's dashboard mock, boards 3 and 4 (revision 2). **Policy:** Ian's amendments. **Spec:** [LEAPS Position Intelligence System v1](../specifications/LEAPS-Position-Intelligence-System-v1.md), first slice.

## Problem

On Portfolio → Positions, each held LEAPS already shows a "PMCC income call" card with a state label (Review income call / Monitor / Market closed / Not ready) and sentences of explanation. It does not show what the position is worth against what you paid, where its breakeven is, or what a candidate income call would earn and risk. The numbers that decide the call were not visible.

## Scope

1. `lib/leaps-position-intelligence/incomeCard.ts` (pure): `buildIncomeCard` turns the position's own facts and the live short-call candidate into tiles and callouts. Rules:

| Item | Rule |
|---|---|
| Value (mark) | Mark × 100 × contracts, with change vs what you paid (green up, amber down) |
| Breakeven at expiry | LEAPS strike + your entry cost per share; compared with the stock price in the portfolio snapshot |
| DTE | Amber below the **180-day** review point (existing policy value) |
| Credit | Executable credit × 100 × contracts, and % of LEAPS cost |
| Short strike | Green at or above breakeven, **red below it** (Ian: breakeven is the floor) |
| If assigned | (short strike − long strike − (entry cost − credit)) × 100 × contracts, before fees (Ian) |
| Delta kept | Long delta − short delta |
| Credit vs extrinsic | Credit ÷ the LEAPS's extrinsic value per month (if price is flat); ≥ 1× good, < 1× watch (**threshold proposed, Ian to confirm**) |
| Events | Always a watch note: earnings and ex-dividend dates are not checked here yet |

2. `PmccReadinessCard` (Positions) shows "Your LEAPS" tiles, "Income call to review" tiles (when the live evaluator returns a candidate), and callouts. The state label and the "Review PMCC short calls" button are unchanged. The long explanatory sentences move under **Details** for Review states and stay visible for Monitor / Not ready.
3. Plumbing: `heldPmccLong` now also carries entry cost, mark, delta and stock price from the position (optional, null when the broker did not supply them); the live candidate also returns the short strike, expiration and OCC symbol. Shared tile/callout pieces moved to `components/dashboard/DashboardParts.tsx`.

## Non-goals (next slices)

- No change to how the state (Review / Monitor / …) is decided. Breakeven is a red callout in v1, not yet a gate on the state.
- No saved mandate (thesis target, income-cap strike), no earnings/ex-dividend data, no decision history.
- "Since you opened" arrows for delta, extrinsic and IV need an entry snapshot and are not shown; value vs paid is the only since-open figure.
- Value is at the mark (the broker's current price), not the bid; the candidate list only appears during market hours (existing behavior of the live evaluator).

## Acceptance criteria

1. Every tile value, tone and callout in the table is produced by `buildIncomeCard` and pinned by unit tests, including breakeven equal/one cent below, credit ratio 1×, DTE 180/179, losses, missing entry cost, missing stock price, no candidate, and multiple contracts.
2. Missing data shows a dash and says so; nothing is estimated.
3. The model carries entry cost, mark, delta and stock price into `heldPmccLong` (pinned by the existing model test).
4. Existing Positions behavior and tests are unchanged.

## Rollout notes

No flag or environment variable. Rollback is a revert.
