# LCC-0001B — Coverage Allocations and Strategy Composition

**Status:** Ready after LCC-0001A
**Depends on:** LCC-0001A
**Blocks:** LCC-0001C, LCC-0001D, LCC-0001E

## Objective

Add durable, auditable support relationships between short calls and shares or long calls, then derive user-facing Stock, LEAPS, Covered Call, and PMCC strategy groupings.

## User value

Users can see what supports every short call, how much capacity remains, and which instruments belong to each strategy without losing the independent positions.

## Scope

### Coverage allocation model

An allocation records:

- Account.
- Underlying.
- Short-call position identity and quantity.
- Foundation type: equity or long call.
- Foundation position identity and allocated quantity.
- Contract multiplier/deliverable evidence.
- Effective timestamps.
- Status: proposed, active, released, unresolved, corrected.
- Source: inferred, user-confirmed, imported, migrated.
- Audit history.

### Allocation rules

- Standard short calls use 100 shares per contract; adjusted contracts use actual deliverables.
- Short stock never provides covered-call support.
- One long call supports no more than one simultaneous standard short call.
- A PMCC long call must expire after the short call.
- PMCC legs must share underlying and compatible deliverables.
- Foundation capacity cannot be double-allocated.
- Working sell-to-open orders reserve capacity but do not become active allocations until filled.
- Closing a foundation cannot silently create uncovered exposure.

### Derived strategies

Derive, do not manually persist as the primary truth:

- Stock Only / Foundation Only.
- LEAPS or Long Call Only.
- Stock Covered Call.
- PMCC — Long Call Diagonal.
- Ready for Next Call.
- Action Needed.
- Coverage Unresolved.
- Closed.

### Portfolio composition

Implement Diane's approved hierarchy from the [Equity-Aware Portfolio mockup](./mockups/tradeedge-equity-portfolio-revision.html):

- Group by underlying for orientation.
- Visibly separate the stock-backed strategy from the long-call-backed strategy.
- Keep each instrument independently accessible.
- Show allocated, reserved, available, and remainder shares.
- Calculate `Total symbol exposure P/L` by counting every instrument exactly once.

### Inference and confirmation

TradeEdge may preselect a relationship only when exactly one eligible foundation exists and quantity, underlying, expiration, allocation, and deliverable rules are unambiguous.

Require user confirmation when:

- Shares and long calls are both eligible.
- Multiple long calls or lots are eligible.
- Quantities do not align.
- Contract deliverables are adjusted.
- Broker history is incomplete.
- An existing relationship would change.

## Non-goals

- Order entry or broker submission.
- Lifecycle reconciliation beyond relationship correction.
- Scanner ranking changes.

## Acceptance criteria

### Share allocation

**Given** 250 long shares and one open standard short call,
**when** the call is linked to shares,
**then** 100 shares are allocated, one additional standard unit is available, and 50 shares remain outside a full unit.

### Long-call allocation

**Given** one eligible long call with no active allocation,
**when** one compatible short call is linked,
**then** the strategy is classified as PMCC and the long call has no remaining short-call capacity.

### Action availability

**Given** a fully allocated foundation,
**when** Portfolio renders it,
**then** the UI shows `Manage Short Call` and does not show another sell-call action.

### Ambiguous coverage

**Given** shares and a long call can both support a short call,
**when** the relationship is created or imported,
**then** TradeEdge requires a coverage choice and records the confirmation.

### Blocked foundation close

**Given** an active short call linked to its only foundation,
**when** the user attempts to close the foundation,
**then** TradeEdge blocks the action until the call is closed, support is replaced, or a separately authorized uncovered state is explicitly allowed.

### P/L deduplication

**Given** a symbol with shares, a stock covered call, a long call, and a PMCC short call,
**when** total symbol exposure P/L is calculated,
**then** each instrument contributes exactly once.

## Implementation notes

- Strategy labels and states must be projections over canonical positions and allocations.
- Relationship edits create audit events and never modify transaction cash flows.
- Do not encode tax-lot identity unless confirmed broker evidence exists; allocation may remain quantity-based.

## Validation

- Invariant tests for over-allocation, expiration, deliverables, and identity.
- Projection tests for every derived strategy state.
- P/L deduplication tests.
- Portfolio composition component tests.
- Existing Portfolio close-order safety tests.

## Rollout

- First run inference in suggestion-only mode.
- Require confirmation for migrated or ambiguous relationships.
- Surface a reconciliation queue before enforcing blocking behavior globally.
