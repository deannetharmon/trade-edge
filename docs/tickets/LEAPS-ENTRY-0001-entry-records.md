# LEAPS-ENTRY-0001 — True entry records for LEAPS and PMCC orders

**Status:** Approved by Dean 2026-09-20 ("go"); implemented — see the [implementation report](../implementation/LEAPS-ENTRY-0001-implementation-report.md)
**Touches the order path:** requires review by **Alan and Ian** before it is run.
**Follows:** [LEAPS-SINCE-0001](./LEAPS-SINCE-0001-since-open.md)

## Problem

The "since you opened" tiles could only compare against the first time the app saw a position, because nothing recorded the market state when a LEAPS or PMCC order was placed. That moment cannot be reconstructed later: every LEAPS bought before this ships has only a first-seen baseline forever.

## Scope

1. **An entry record, written by the server when the broker accepts an order.** `lib/leaps-position-intelligence/entryRecords.ts` (pure) builds it from the review the server already resolved from the broker for that order: stock price and quote time; for each leg the strike, expiry, DTE, bid, ask, mid, delta, IV, open interest and quote time; the long call's extrinsic (mid less intrinsic); quantity, limit price, price effect, broker order id. It holds no tokens and no account number.
2. **Three kinds:** `leaps-entry` (LEAPS buy), `pmcc-entry` (PMCC pair, both legs), `short-call-sold` (a short call sold against a held LEAPS, with the LEAPS's state as context; the seed of per-cycle history).
3. **Storage:** append-only Redis lists per user + broker account + LEAPS contract (keys hash all three), newest first, 200 per contract, 5-year retention, one record per broker order id (a repeat is a no-op). Helpers are in `entryRecordsStore.ts` (server only).
4. **Read:** `GET /api/leaps-entry-records` (signed-in user's own records only). There is deliberately **no write endpoint**.
5. **Use:** the Positions cards pick the record for the position's open date (the latest order placed on or before the broker's open date, one day of tolerance) and use its stock price and delta as the baseline. Labels stay honest: "Since you opened" when the order was placed within a day of the fill; "Since you placed the order <date>" for a good-till-cancelled order that filled later (extrinsic is then omitted, because the fill price is not the order-time price); otherwise the first-seen baseline as before. IVR still comes only from the first-seen baseline (the server does not have IVR at order time), and is used only when that baseline was itself taken at the open.

## Order-path safety rules (what the tests pin)

- Capture runs **only after the broker has accepted a submitted order**, in the same request, at three points in `serverTradeReview.ts` (LEAPS submit, PMCC pair submit, held-LEAPS short-call submit).
- **Never** for a dry run, a contract that did not qualify, a blocked decision, or an order the broker refused.
- It can **never throw and never change the order's result**: every failure (no Redis, a Redis error, a timeout, an unexpected shape) is swallowed and logged without details; there are two independent guards.
- It waits at most **2 seconds**; a late failure after the timeout cannot become an unhandled rejection.
- The order request sent to the broker, its validation, and its response are unchanged.

## Non-goals

- Positions you already hold have no record; they keep the first-seen baseline. Orders placed outside TradeEdge are not seen.
- No cycle-history screen and no decision events yet (the `short-call-sold` records are the raw material).
- IV is stored exactly as the broker reports it (no unit conversion); it is recorded for future use and not displayed.

## Acceptance criteria

1. Builder, order-id parsing, open-date matching (same day, GTC later fill, latest-on-or-before, one-day tolerance, wrong kinds, no/invalid date), Redis helpers (order, TTL, duplicate, trim to 200, isolation by user/account/contract, hashed keys, malformed entries skipped), and the capture wrapper (saved, duplicate, Redis failure, missing config, unexpected input, timeout, late failure) are unit-tested.
2. Wiring tests with a stubbed broker prove each of the rules above for all three order paths; they fail on the previous `serverTradeReview.ts` (4 of 10).
3. The read route requires a session, reads only the caller's key, validates identifiers, leaks no error detail, and exposes no write method.
4. Existing tests are unchanged.

## Rollout notes

No flag or environment variable (uses the existing Redis). Rollback is a revert; existing records simply stop being read.
