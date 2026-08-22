# LCC-0001C — Position Entry and Management Workflows

**Status:** Ready after LCC-0001B
**Depends on:** LCC-0001A, LCC-0001B
**Blocks:** LCC-0001D, LCC-0001E

## Objective

Implement the user workflows for standalone long calls/LEAPS, stock covered calls, buy-writes, new PMCCs, and short calls sold against existing positions.

## UX reference

Use Diane's [Integrated LEAPS, Covered Call, and PMCC Flow](./mockups/tradeedge-integrated-leaps-flow.html) and [Equity-Aware Portfolio](./mockups/tradeedge-equity-portfolio-revision.html). Preserve the existing TradeEdge shell, Screener launcher, Portfolio workspace, modal conventions, themes, and accents.

## Workflow boundary

Keep these stages distinct:

1. **Discovery:** candidate opportunity.
2. **Planning:** proposed legs and estimated outcomes.
3. **Execution evidence:** manual record or broker match.
4. **Tracking:** open positions and relationships in Portfolio.

A scanner result or saved plan is never an open position.

## Scope

### Standalone long call / LEAPS

- Review a long-call candidate independently.
- Save a plan.
- Record or import the executed long call.
- Display `Foundation Only` with `Sell Call Against Position` when eligible.

### New PMCC

- Review the proposed long and short legs.
- The proposed long leg is the predetermined support; do not ask an unnecessary coverage question.
- Record actual fills or match broker activity.
- Create two independent positions and one active relationship only from execution evidence.

### Stock covered call

- Start from an equity holding with verified available capacity.
- Find eligible calls.
- Disclose the exact quantity allocation.
- Record or import execution.
- Derive the covered-call strategy.

### Buy-write

- Record stock purchase and short-call sale with a shared order relationship.
- Activate coverage only for actually filled quantities.

### Call against existing position

- Use one shared action: `Sell Call Against Position`.
- If the action begins from a specific eligible foundation, disclose it.
- If multiple foundations are eligible, require selection.
- Fully allocated foundations show `Manage Short Call`, not a new sell action.

### Execution evidence

Provide separate choices:

- `Record Executed Trade`.
- `Import or Match Broker Activity`.

Do not label planned prices as fills. Retain actual fill quantity, price, fees, timestamps, and broker identifiers.

## Required calculations

- Gross premium received.
- Current short-call liability.
- Realized and unrealized short-call P/L.
- Foundation realized and unrealized P/L.
- Original transaction basis.
- Net strategy basis, clearly non-tax.
- Total strategy P/L with no double counting.
- Called-away return where applicable.
- For a new one-to-one diagonal, initial theoretical max loss may equal net debit under approved assumptions; do not keep this label after material lifecycle changes.

## PMCC validation

Evaluate:

- Underlying and deliverable compatibility.
- Long expiration after short expiration.
- Long strike below short strike for the intended configuration.
- Long delta, intrinsic value, and extrinsic value.
- Net debit and strike width.
- Liquidity and quote timestamps.
- Dividend and early-assignment exposure.

The check `initial net debit < strike width` is a warning signal, not a profitability guarantee.

## Partial execution

Represent actual fills:

- Long fills; short does not → Long Call/LEAPS Only.
- Shares fill; short does not → Stock Only.
- Short fills without sufficient foundation → Action Needed.
- Unequal quantities → allocate only verified supported quantity.
- Multiple fills → retain every execution and compute weighted economics.

## Non-goals

- Automatic broker execution unless separately authorized.
- Automatic roll recommendations.
- Assignment reconciliation; delivered in LCC-0001D.
- Scanner ranking changes; delivered in LCC-0001E.

## Acceptance criteria

### LEAPS only

**Given** a proposed long call,
**when** the user records only the long-call execution,
**then** Portfolio shows an independent Foundation Only position with no short-call liability.

### New PMCC

**Given** both proposed PMCC legs fill,
**when** execution is confirmed,
**then** TradeEdge creates two positions, links the short call to the long call, and classifies the strategy as PMCC.

### Existing shares

**Given** verified available share capacity,
**when** a short-call fill is recorded against the holding,
**then** TradeEdge creates the option position and allocates the required share quantity.

### Proposed versus executed

**Given** scanner prices differ from actual fills,
**when** execution is recorded,
**then** all accounting uses actual fill evidence while the proposal remains historical planning context.

### Partial PMCC

**Given** the long leg fills and the short leg is cancelled,
**then** TradeEdge shows LEAPS Only and does not fabricate a PMCC relationship.

## Validation

- Given/When/Then component and integration tests for every entry path.
- Golden calculation tests approved by Alan.
- Partial-fill and multi-fill tests.
- Action-visibility tests for capacity states.
- Accessibility tests for dialogs, choices, and confirmations.

## Rollout

- Release manual record and broker matching before any order-submission integration.
- Feature-flag each entry path.
- Capture workflow completion and reconciliation rates without measuring trading performance.
