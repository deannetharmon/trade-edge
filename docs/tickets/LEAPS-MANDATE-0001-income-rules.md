# LEAPS-MANDATE-0001 — Saved income rules and real gates on the Positions card

**Status:** Approved by Dean 2026-09-20 ("go"); implemented — see the [implementation report](../implementation/LEAPS-MANDATE-0001-implementation-report.md)
**Follows:** LEAPS-POS-0001/0002, LEAPS-EVENTS-0001. **Spec:** LEAPS Position Intelligence System v1 (mandate, decision policy). **Policy:** Ian.

## Problem

The Positions card could show breakeven, upside, and event dates, but it could not act on them: a candidate call below your breakeven, with earnings inside its window, or that gives away too much of your upside still showed as "Review income call". The rules that belong to you (your target, your floor, whether you sell through earnings) had nowhere to live.

## Scope

1. **Save your rules per held LEAPS** (one screen, six fields): target price, income floor strike (blank = your breakeven), posture (upside first / balanced / income first), allow selling through earnings, invalidation price (optional), minimum credit per share (optional). Stored per user, account and contract with an immutable audit event and an idempotency record, using the existing persistence layer (`lib/leaps-position-intelligence/persistence`).
2. **API** `/api/leaps-mandate`: `GET` reads your saved rules (scoped to the signed-in user); `POST` validates them (`lib/leaps-position-intelligence/mandate.ts`), confirms **server-side that the broker shows you holding this long call** (the account stored under is the broker-confirmed one, never the one in the request), then saves.
3. **Gates** (`lib/leaps-position-intelligence/mandateGates.ts`) mirror the engine's rules and reuse its policy values. First failing rule sets the state:

| Order | Rule | State when it fails |
|---|---|---|
| 1 | Stock at or below your invalidation price | **Reassess thesis** |
| 2 | Earnings before the call expires, unless you allow it (**default: not allowed**) | **Monitor** |
| 3 | Credit below your minimum | **Monitor** |
| 4 | Short strike below your income floor (**default: your LEAPS breakeven**, per Ian) | **Monitor** |
| 5 | The call keeps less of the way to your target than your posture needs (70% / 55% / 40%) | **Hold uncovered** |

   The card shows the resulting state, red callouts for what failed and green ones for what passed, an **Upside kept** tile when a target is set, and it turns off the "Review PMCC short calls" button while a gate is failing.
4. **Defaults with no saved rules:** breakeven floor and no selling through earnings still apply (Ian). Participation is only checked once you set a target.
5. **Unverified event data is not a gate:** it stays an amber note, because the PMCC review re-checks events itself; a failing calendar provider must not lock you out of reviewing.

## Non-goals

- The Positions model's own status decision and the PMCC review flow are unchanged; gates are applied on the card (label, callouts, button).
- No decision history screen yet (audit events are being written), no per-underlying rules, no gate on the open-cycle card.
- The full engine (`evaluateLeapsPositionIntelligence`) is not yet fed live facts; the gates reuse its rules and thresholds.

## Acceptance criteria

1. Every rule, boundary and precedence in the table is pinned by unit tests (breakeven exact / one cent below, saved floor both ways, earnings default and allowed, minimum credit equal / above, each posture floor, invalidation at / above / below the stock, clamping, missing target / price / entry cost, purity).
2. Validation rejects negative, zero, non-numeric and infinite numbers, unknown posture, non-boolean earnings, over-long text and invalidation ≥ target; drops unknown fields and ignores a client-supplied version.
3. The route requires a session, reads only the signed-in user's scope, refuses a contract the broker does not show as held, never stores under a client-supplied account, leaks no internal error detail, and reports a replayed request id as replayed.
4. Existing Positions behavior and tests are unchanged.

## Rollout notes

No flag or environment variable (uses the existing Redis). Rollback is a revert; saved rules simply stop being read.
