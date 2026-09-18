# LEAPS-FLOW-0001 — Broker-first standalone LEAPS discovery and execution

## Owner

Dane

## Problem

The current LEAPS experience is split across incompatible surfaces:

- Portfolio correctly shows live broker positions.
- Screener presents a disabled **Find LEAPS — Coming Soon** control.
- Long Book can scan and submit a LEAPS order but persists a separate browser-local position list, so it appears empty for broker-held LEAPS.

This makes it unclear where a trader should discover, open, and manage a standalone LEAPS position. No workflow may require the trader to recreate a live broker position in a local tracker.

## Product decision

The broker is the sole source of truth for order status, fills, positions, P/L, and buying power.

The live standalone LEAPS journey is:

```text
Find LEAPS → results → contract review → broker confirmation → broker order lifecycle → Portfolio
```

Long Book is not a source of truth and is not a destination in this release. It must not receive a locally fabricated position after order submission.

## Scope

Implement the approved five-screen flow.

### 1. Find LEAPS setup

- Enable a real **Find LEAPS** launcher from Screener when a selected Opportunity Universe is available.
- Display the source/count, for example `44 selected tickers · Opportunity Universe`.
- Required fetch boundary: DTE minimum and maximum; initial presets `90–180`, `180–365`, `365–730`, and `180–730`. Do not substitute year-based ranges that extend beyond the approved maximum.
- Required result filters: option direction (call/put), delta range, minimum OI, and maximum bid/ask width in dollars per share.
- Initial defaults: DTE `365–730`, delta `.70–.85`, OI `100`, width `$0.20`.
- Clearly label which controls require a rescan (fetch boundary) and which operate on returned candidates (result filters).
- Do not expose spread credit ratio, POP, ROC, or a credit profit target.

### 2. Results

- Return liquid long-option candidates only from the selected universe.
- Display ticker, exact friendly contract, DTE, delta, debit/mid, IVR, OI, bid/ask width, quote timestamp, and concise thesis/context evidence.
- Mark each row as a candidate, never an order or a held position.
- Selecting a candidate opens Contract Review; it does not create a local position or submit an order.

### 3. Contract review

- Display the exact OCC symbol, broker quote timestamp, bid, ask, mid, DTE, OI, quantity, editable limit debit, total debit, and maximum loss.
- Replace a repeated numeric delta read with a compact **Matches selected delta range** eligibility check. Delta is already used as the setup criterion and results comparison value; do not add a separate Greeks display to review or order confirmation.
- Maximum loss is the total premium paid (`limit debit × quantity × 100`) for the long option.
- Perform a broker buying-power check before the user can continue.
- Immediately before enabling **Submit Broker Order**, refresh the selected contract quote and repeat the buying-power check. A stale, unavailable, or failed refresh disables submission and explains why.
- Provide optional thesis notes.
- State exactly: **No automatic exit is attached; management remains deliberate and manual.**

### 4. Broker order confirmation

- Show selected account, exact OCC symbol, action `Buy to Open`, quantity, limit debit, and estimated total debit.
- Require an explicit acknowledgement: **I understand max loss is limited to premium paid.**
- Submit a broker order only after acknowledgement and current buying-power validation succeed.
- State visibly: submitting is not a fill; final execution, price, and availability are determined by the broker.

### 5. Broker lifecycle and Portfolio handoff

- Show broker-backed states: `Submitted`, `Working`, `Partial fill`, `Filled`, `Canceled`, `Rejected`, and `Expired`.
- `Canceled`, `Rejected`, and `Expired` are alternative terminal outcomes from a submitted/working order; they are never displayed after `Filled`.
- A partial fill creates a Portfolio position for the broker-confirmed filled quantity and retains the remaining working-order quantity/status separately.
- A full fill creates/updates the Portfolio position from the broker-confirmed fill only.
- No fill means no Portfolio position is created.
- Provide `View order in broker`; provide `Cancel remaining order` only while a remaining quantity is working.
- Refresh Portfolio from broker data after a fill/status event; do not construct a fake local position payload.

## Non-goals

- Do not migrate Long Book's local-storage position list into Portfolio.
- Do not use Long Book as a live LEAPS order handoff or require duplicate manual entry.
- Do not attach automatic GTC profit targets, stops, or exit automation to standalone LEAPS.
- Do not implement PMCC discovery, pairing, or short-call management in this ticket.
- Do not add the reverted LEAPS thesis-health display work in this ticket.
- Do not treat debit entries as credit-capture strategies.

## Implementation notes

- Reuse the existing selected Opportunity Universe and broker authentication/account selection patterns.
- Use broker option-chain and quote data for the scan and Contract Review. Quote data must carry a trustworthy broker timestamp; unavailable quote data fails closed for order review.
- Use a broker order ID as the lifecycle identity. Never infer fill state from local UI state or submission acknowledgement.
- Model partial fills explicitly: `filledQuantity`, `remainingQuantity`, average fill price, and broker status.
- Keep scanner candidate state, broker order state, and broker positions as separate typed models. Only the broker fill event may connect an order to a Portfolio position.
- Reconcile an in-flight order on refresh/page reload from the broker before rendering status or enabling cancellation.
- Replace the disabled Screener launcher only when this complete flow is enabled; until then, retain an honest unavailable state rather than redirecting to Long Book.

## Acceptance criteria

1. A trader with a selected universe can launch Find LEAPS from Screener and scan long-dated call or put candidates.
2. Setup visibly distinguishes fetch boundaries from result filters and does not display spread-credit economics.
3. Every result shows quote evidence and is presented as a candidate, not an order or position.
4. Contract Review displays exact OCC symbol, quote timestamp, delta-range eligibility, total debit, maximum loss, and a current broker buying-power outcome without duplicating a Greeks read.
5. Submit remains disabled until the debit-risk acknowledgement passes and a fresh quote plus buying-power validation pass immediately before submission.
6. A submitted order is never represented as filled or as a Portfolio position.
7. A partial fill appears in Portfolio only for filled quantity while the remaining quantity is visibly working and cancelable.
8. Filled positions are loaded by Portfolio from broker data after confirmation; canceled, rejected, and expired orders create no position.
9. Refresh/reload reconciles order state from the broker and does not rely on local storage for live status.
10. The implementation contains no redirect from Find LEAPS to Long Book and no local Long Book write as part of this flow.
11. Keyboard, focus, validation, loading, no-universe, no-account, stale-quote, insufficient-buying-power, rejected-order, canceled-order, expired-order, partial-fill, and full-fill states are tested.

## Validation

1. Unit-test scan criteria classification, debit/max-loss math, eligibility, order-state transition rules, and partial-fill aggregation.
2. Integration-test setup → result → review → confirmation with mocked broker responses.
3. Integration-test all lifecycle branches, including reload/reconciliation and cancellation of remaining partial quantity.
4. Run an end-to-end broker sandbox/dry-run test before enabling live submission.
5. Capture implementation screenshots against the approved five-screen mock before release.

## Rollout

1. Ship behind a dedicated standalone-LEAPS flow flag, disabled by default.
2. Enable discovery and review first against broker data; validate candidate and quote behavior.
3. Enable broker submission only after sandbox/dry-run validation and product sign-off.
4. Enable the Screener launcher only with the complete broker lifecycle handoff.
