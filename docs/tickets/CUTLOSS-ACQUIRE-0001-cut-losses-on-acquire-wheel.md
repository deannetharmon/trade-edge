# CUTLOSS-ACQUIRE-0001 — Cut Losses on Acquire and Wheel positions

## Status

**APPROVED 2026-10-06** (Ian, Paul, Quinn). Not built. Display/availability of a manual button; no recommendation, scoring or order-body change. Targeted tests plus the full suite (shared action logic).

## Problem

TQQQ and METU (Acquire CSPs) show Hold with a Cut Losses button beside it. `isActionRelevant` (`app/portfolio/page.tsx` ~1694) offers Cut Losses on any position with a midpoint loss (TE-0002 Round 4). For Acquire and Wheel positions assignment is the plan (DECIDE-0001; CLAUDE.md methodology exception), so a paper loss alone is not a reason to close, and the button contradicts the recommendation.

## Ruling (Ian)

- Short puts and covered calls with `pos.intent` `acquisition` or `wheel`: Cut Losses is offered **only when the canonical recommendation is CUT_LOSSES**.
- Close Position stays available on every position: the trader can always exit.
- Every other intent (income, unset) and every other structure: unchanged.
- No stop added or removed; no change to the Add Stop dialog's "assignment is the plan" note.

## Scope (Paul)

In: the availability rule above at every place the action list is built. Out: renaming Cut Losses, recommendation changes, any other action. No mock (a button disappears; no new UI).

## Quinn

1. **Four call sites, one rule.** `isActionRelevant` is called from the card action bar (~9223, passes the canonical action), the batch bar (~10166 and ~10188) and the Positions workspace (`getManagementActions`, ~11256, passes **no** canonical action). Under the new rule the workspace would hide Cut Losses even when the recommendation is Cut Losses. Every call site must pass the canonical action, using the same mapping the card bar uses.
2. Put the rule in a pure helper in `lib/portfolio/` (for example `cutLossesAvailable(pos, canonicalAction)`), called by `isActionRelevant`, so it is testable without the page.
3. **Tests:**
   - Acquire CSP at a loss, recommendation Hold: no Cut Losses; Close Position present.
   - Acquire CSP, recommendation Cut Losses: Cut Losses present (workspace and card bar).
   - Wheel covered call at a loss, Hold: no Cut Losses.
   - Income CSP at a loss, Hold: Cut Losses present (unchanged).
   - Unset intent: unchanged.
   - Batch bar with a mixed selection: Cut Losses targets exclude the Acquire/Wheel Hold positions.
