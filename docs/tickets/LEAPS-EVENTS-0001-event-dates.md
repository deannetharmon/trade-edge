# LEAPS-EVENTS-0001 — Real earnings and ex-dividend dates on the Positions income and cycle cards

**Status:** Approved by Dean 2026-09-20 ("go"); implemented — see the [implementation report](../implementation/LEAPS-EVENTS-0001-implementation-report.md)
**Follows:** [LEAPS-POS-0001](./LEAPS-POS-0001-income-card.md), [LEAPS-POS-0002](./LEAPS-POS-0002-cycle-card.md)

## Problem

Both Positions cards carried a standing note, "earnings and ex-dividend dates are not checked here yet". Those two dates decide whether a short call is safe to sell (earnings gap risk) and whether an open call can be assigned early (ex-dividend), so the card could not say the thing that mattered most.

## Scope

1. `lib/leaps-position-intelligence/eventNote.ts` (pure): `buildEventCallouts` and `isNearItm`. Rules follow the app's existing event policy (`lib/scans/eventRisk.ts`), applied to the window from today to the short call's expiration:

| Situation | Callout |
|---|---|
| Data could not be verified (provider error, unverified payload) | Amber: "could not be verified: check them before relying on this call". **Never shown as clear.** |
| Earnings in the window, call **not yet sold** | **Red** (existing policy treats this as a blocker) |
| Earnings in the window, call **already open** | Amber |
| Ex-dividend in the window and the call is near or in the money (within 3% of the stock, the cycle card's band) | **Red**: early assignment is possible |
| Ex-dividend in the window, call comfortably out of the money | Amber |
| Nothing in the window | Green: "No earnings or ex-dividend date before <expiry>." |

2. The Positions card fetches `/api/event-risk` (the existing endpoint the PMCC modals and the PMCC lifecycle banner already use) for the candidate short call's expiration, or for the open short call's expiration, and passes the callouts to the income and cycle card builders, which use them in place of the standing note.
3. While loading, the card says "Checking earnings and ex-dividend dates…".

## Non-goals

- No change to how the state (Review / Monitor / …) is decided; a red earnings callout is shown but does not yet change the state (that arrives with the saved mandate's "allow earnings" setting).
- No new data provider. The endpoint uses Financial Modeling Prep and needs `FMP_API_KEY`; when the key is missing or the payload is not verified the card says the dates could not be verified.
- Split and symbol-change dates are not shown on these cards.

## Acceptance criteria

1. Each row of the table is pinned by unit tests, including the window boundaries (today and the expiry day included, the day before today and after expiry excluded), malformed dates ignored, and both events at once.
2. Unverified or missing data never produces a green "clear" note.
3. Supplied event callouts replace the standing note on both cards (including an empty list); without them the previous behavior is unchanged.
4. `isNearItm` uses the same 3% band as the cycle card and treats an unknown stock price as not near.

## Rollout notes

No flag. Requires `FMP_API_KEY` (already used by the PMCC event-risk gating). Rollback is a revert.
