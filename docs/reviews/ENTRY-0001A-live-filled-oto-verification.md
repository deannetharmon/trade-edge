# ENTRY-0001A — Live Filled-OTO Verification

**Owner:** Quinn  
**Purpose:** Verify the live broker identity handoff without placing, modifying, or cancelling an order as part of this procedure.

## Preconditions

- A BPS or BCS OTO order has been submitted through TradeEdge and its entry trigger has fully filled.
- The reviewer is signed in to the same TradeEdge user and has the same active broker account selected.
- The broker ledger includes executed `Trade` transaction records for that entry.

## Procedure

1. Open Trade Log and select a range containing the entry transaction; use **Refresh**.
2. Verify the broker transaction has `transaction-type: Trade`, an `executed-at` timestamp, and an `order-id` equal to the OTO trigger/component order ID returned by the complex-order acknowledgement.
3. Verify the pending-entry record is read only from the active authenticated-user + broker-account scope, and that promotion retrieves the broker ledger server-side rather than accepting transaction evidence from the browser.
4. Verify a single immutable snapshot is created with:
   - the confirmed transaction ID in `executionId` and `sourceTransactionIds`;
   - the complex order ID as the trade-group ID;
   - captured quote evidence or explicit unavailable states; and
   - no contingent OTO exit order used as opening evidence.
5. Refresh Trade Log again. Verify the same snapshot is returned unchanged rather than overwritten or duplicated.
6. Once the position closes and appears in Performance, verify its `sourceTransactionIds` joins the entry snapshot and that the Entry Context Outcomes totals count it once.

## Pass / fail conditions

| Result | Meaning |
|---|---|
| Pass | Every matching transaction is an executed Trade with matching `order-id`; one immutable snapshot is created and joins the closed trade. |
| Fail closed | No snapshot is created when the transaction is missing, lacks an execution timestamp, has a different `order-id`, or represents a contingent exit. |
| Defect | A snapshot is created from symbol/time/price proximity, is cross-account/user visible, is overwritten, or duplicates after refresh. |

## Evidence to retain

Record only non-sensitive identifiers needed to reproduce the result: snapshot ID, complex-order ID, entry component order ID, transaction ID, and the pass/fail outcome. Do not record credentials, account balances, tokens, or full broker payloads.
