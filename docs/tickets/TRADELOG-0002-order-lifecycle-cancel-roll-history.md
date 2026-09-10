# TRADELOG-0002 — Order Lifecycle History for Cancellations and Rolls

**Audience:** Dane (implementation owner)  
**Product:** Ian  
**Requirements:** Paul  
**Design review:** Diane  
**Data/identity review:** Quinn  
**Status:** Proposed

## Problem

Trade Log reconstructs completed option-trade economics from broker transactions. That is correct for realized P/L, but it means a canceled opening order has no record in TradeEdge. The current pending-order cancellation path cancels at the broker and refreshes the page without persisting an Order History or lifecycle event.

Rolls need a related distinction. A roll is an execution workflow that closes an existing position and opens a new one. It must not be represented as one synthetic realized trade, and it must not be assumed complete merely because an OTOCO roll was submitted.

## User value

The trader can see what happened to every TradeEdge-initiated order—submitted, working, canceled, failed, and filled—and can follow a completed roll from the old position to its new position without corrupting realized P/L or performance analysis.

## Product decisions

1. **Trade Log** remains a filled/closed-trade and realized-economics record. Canceled and working orders do not enter its realized-P/L or Performance calculations.
2. Add a durable **Order History** / lifecycle record for order-state events. It is distinct from Trade Log and may be surfaced beside it or as a clearly labeled tab.
3. Every record must use broker IDs and broker-observed status when available. Do not infer cancellation, fills, or roll linkage from symbol, strategy, or timing alone.
4. A roll is a linked workflow, not a synthetic single trade: old-position close and new-position opening execution remain separate economic records.
5. A submitted or working roll is never displayed as completed. The old position remains open until the close execution is confirmed.
6. This ticket records facts and links. It does not add new roll-selection policy, automatic roll behavior, or P/L rules.

## Scope

### 1. Durable order-lifecycle event contract

Create a server-owned, versioned `OrderLifecycleEvent` contract with at least:

| Field group | Required fields |
|---|---|
| Identity | event ID, account ID, broker order ID, broker complex-order ID when applicable, parent/child order IDs, TradeEdge command/workflow ID, user ID |
| Order context | symbol, strategy when known, legs, quantity, order type, price effect, requested limit/stop, time in force |
| State | submitted, working, canceled, rejected, failed, filled, partially filled; observed-at timestamp; source (TradeEdge command or broker refresh) |
| Execution evidence | actual fill ID(s), fill timestamp(s), filled quantity, actual price(s), fees when broker evidence supplies them |
| Linkage | position identity when known, canonical closed-trade ID when created, `rollWorkflowId` when relevant, predecessor/successor order IDs |
| Diagnostics | concise broker failure/cancel reason when supplied, source freshness, schema version |

Events must be idempotent by broker identity plus observed state/fill identity. Repeated refreshes must update or deduplicate the same event rather than creating a second cancellation or fill record.

### 2. Cancellation recording

When TradeEdge cancels an order and the broker confirms the request:

- persist a `canceled` lifecycle event before or alongside the UI refresh;
- retain the original submitted/working order context and broker ID;
- record whether it was an opening entry, exit, attached contingency, or roll child when that identity is known;
- show it in Order History with timestamp, symbol, requested price, and broker order ID;
- do **not** create a Trade Log trade, realized P/L, closed-trade result, or Performance event.

If the broker cancellation fails, persist a `failed` attempt only when the broker response is definitive; otherwise show the error without claiming the order was canceled. A subsequent broker refresh may reconcile the final broker status.

### 3. Roll workflow linkage

When the trader submits a Close + Roll OTOCO workflow:

- create one `rollWorkflowId` and persist a `submitted`/`working` roll lifecycle event linked to the broker complex order;
- record the existing position/order identity and the intended new-position structure separately;
- when the close trigger actually fills, link the broker-confirmed close execution to the old position and its canonical closed-trade record;
- when the opening child actually fills, link it to a new opening position/execution record and preserve `rolledFrom` / `rolledTo` linkage;
- if the close fills but the opening child has not yet filled, show the roll as **partially completed** and display the broker-observed state of each leg; never fabricate the new position;
- if the close or opening child is canceled/rejected/failed, record the state and retain all broker IDs and available execution evidence.

Trade Log must continue to display the old position’s actual close and realized P/L independently. The new position is a new opening record. Each may display a compact “Rolled from/to” link, but neither entry may combine their economics into an invented roll P/L.

### 4. Read surface

Provide an Order History/lifecycle read surface that supports:

- newest-first event history;
- visible status text in addition to color;
- symbol, strategy/legs when known, requested price, actual fill evidence when available, timestamps, and broker ID;
- a compact roll group that shows old close and new open child states without obscuring their individual records;
- filters for status and workflow type when the existing Trade Log filtering pattern can be reused without a new filtering system;
- an explicit empty state that distinguishes “no lifecycle events” from unavailable broker data.

Diane must ensure canceled orders are visually subordinate to active positions and closed-trade performance, while roll grouping is understandable at desktop and narrow widths.

## Non-goals

- Treating cancellations as completed trades or calculating P/L from them.
- Combining old and new position economics into a synthetic roll P/L.
- Inferring a roll from similar trades without a shared broker/workflow identity.
- Changing roll-candidate selection, credit thresholds, stop policy, or order-submission behavior.
- Retroactively reconstructing lifecycle events where neither TradeEdge nor Tastytrade provides an identity/status record.
- Replacing the canonical closed-trade reconstruction used by Trade Log and Performance.

## Acceptance criteria

### Canceled pending entry

**Given** a pending opening order submitted through TradeEdge,  
**when** the trader cancels it and the broker confirms cancellation,  
**then** Order History shows one durable `Canceled` record with the broker order ID and requested order context, while Trade Log and Performance do not show a trade or realized P/L.

### Canceled exit or attached order

**Given** a working exit, stop, profit target, or attached contingency,  
**when** it is canceled and the broker confirms it,  
**then** Order History records the cancellation linked to the still-open position when that relationship is known, without changing the position to closed.

### Working roll

**Given** a trader submits a Close + Roll workflow,  
**when** the broker accepts it but no trigger fill has occurred,  
**then** Order History shows `Roll in progress` with close and opening-child status, and the existing position remains open.

### Completed roll

**Given** the broker confirms both the close execution and new opening execution,  
**when** Trade Log refreshes,  
**then** the old position is recorded using its actual close execution, the new position is recorded as a new opening execution, and both records carry the same durable roll linkage without combining P/L.

### Failed or partial roll

**Given** a roll child is rejected, canceled, or remains unfilled after the close fills,  
**when** the broker status is available,  
**then** Order History displays the broker-observed status of each child and does not claim that the new position exists or that the workflow completed.

### Idempotency and reconciliation

**Given** TradeEdge refreshes broker orders multiple times,  
**when** the same broker status/fill is received again,  
**then** it does not duplicate lifecycle records; late broker status changes update the related workflow by broker identity.

## Implementation notes

- Do not reuse the current browser-local Audit Log as the source of truth. It is not durable across devices and does not cover pending-order cancellation.
- Persist lifecycle events server-side under the authenticated TradeEdge user and account identity. Protect broker identifiers and any error payloads according to existing account-data handling.
- Prefer an explicit command/workflow ID created before submission and then attach returned broker order/complex-order IDs. Persist the mapping before relying on a later refresh.
- Reconciliation reads must use the broker’s order/complex-order status and transaction/fill evidence. A DELETE response alone must not be treated as a fill or a closed position.
- Reuse canonical closed-trade reconstruction only after actual close fills are available. Do not rewrite its economics.
- Record broker API unavailable/partial evidence honestly. An uncertain state is `Unknown`/`Needs refresh`, not `Canceled` or `Filled`.
- Keep pure lifecycle transition, linkage, and deduplication logic outside page components and cover it with fixtures.

## Validation

- Unit tests for lifecycle transition validity, idempotency keys, broker status mapping, and no-P/L cancellation behavior.
- Integration tests for pending-entry cancellation, GTC exit cancellation, and cancel failure.
- Integration tests for roll submitted, working, close-filled/open-working, both-filled, child rejected, and child canceled states.
- Tests proving Trade Log and Performance exclude canceled/working lifecycle events and retain actual close economics.
- Contract tests for broker order, complex-order, and fill identity linkage.
- Accessibility review for status labels, grouped roll state, error/unknown state, and narrow-width layout.

## Rollout

Release behind an order-lifecycle-history flag. Validate first with a canceled pending entry and a broker-confirmed roll lifecycle in a controlled account. Quinn approves identity/reconciliation evidence; Ian verifies that economic separation is correct; Diane approves the compact lifecycle presentation before broad enablement.
