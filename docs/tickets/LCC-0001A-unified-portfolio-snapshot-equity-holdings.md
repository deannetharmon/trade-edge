# LCC-0001A — Unified Portfolio Snapshot and Equity Holdings

**Status:** Ready for technical specification
**Depends on:** None
**Blocks:** LCC-0001B, LCC-0001C, LCC-0001D, LCC-0001E

## Objective

Create one normalized portfolio snapshot for equities, options, and working orders, then display actual equity holdings in the existing Portfolio workspace without regressing option-position behavior.

## Problem

`loadPositions()` currently filters raw broker positions to `Equity Option` and `Index Option`. Covered Call capacity separately reads unfiltered positions and live orders. Portfolio and Screener therefore hold different representations of what the user owns.

## User value

Users see their actual shares, basis status, market value, P/L, and covered-call capacity in the same workspace as their options.

## Scope

### Shared portfolio snapshot

Create a normalized account-scoped snapshot containing:

- Equity holdings, including long and short direction.
- Option positions.
- Live/working orders and legs.
- Broker identifiers and account identity.
- Snapshot and quote timestamps.
- Data-quality status and diagnostics.

The snapshot becomes the shared source for Portfolio and Covered Call capacity. Existing option-specific `Position` behavior may remain behind an adapter during migration.

### Equity holding model

At minimum, retain:

- Account identifier.
- Symbol and instrument type.
- Long or short direction.
- Total quantity and settled quantity when available.
- Broker-reported basis and `basisComplete` status.
- Current price, market value, and unrealized P/L.
- Quote timestamp and stale-data state.
- Standard or adjusted deliverable information where applicable.
- Data-quality warnings.

### Portfolio presentation

Add equity holdings to the existing Positions workspace using Diane's [Equity-Aware Portfolio mockup](./mockups/tradeedge-equity-portfolio-revision.html).

Display:

- Quantity.
- Average basis or `Basis unavailable`.
- Current price and market value.
- Unrealized P/L.
- Allocated, reserved, available, and remainder shares once allocation data is available.
- Data-quality state.

LCC-0001A may initially show capacity derived from the existing conservative capacity logic while LCC-0001B adds durable allocations.

### Existing behavior preservation

- Do not force equities into option-leg assumptions such as DTE, expiration, option Greeks, or credit/debit structure.
- Preserve existing option cards, close-order safety, recommendations, and position intelligence unless explicitly adapted.
- Clearly define which portfolio summaries include equities, options, or both.

## Source-of-truth rules

1. Broker executions establish transaction history.
2. Broker positions establish current holdings.
3. Working orders reserve potential exposure.
4. Broker position snapshots never silently rewrite transaction history.
5. Market data affects valuation, not instrument identity.
6. Multiple accounts remain distinct unless the UI explicitly provides aggregation.

## Fail-closed behavior

Coverage-dependent actions are unavailable when:

- Positions cannot be loaded.
- Working orders cannot be loaded.
- Open short-option exposure cannot be attributed to an underlying.
- Account identity is unresolved.
- Deliverables are incompatible or unknown.

Existing holdings remain visible where reliable; the UI explains which calculation is unavailable.

## Non-goals

- Durable strategy relationships; delivered in LCC-0001B.
- New trade-entry workflows; delivered in LCC-0001C.
- Scanner redesign; delivered in LCC-0001E.
- Tax-lot optimization.

## Acceptance criteria

### Equity visibility

**Given** the broker reports 250 long MSFT shares,
**when** Portfolio loads successfully,
**then** TradeEdge displays the 250-share equity holding with market value, basis status, quote timestamp, and P/L.

### Short stock

**Given** the broker reports a short equity position,
**when** Portfolio loads,
**then** the position remains visible but contributes no covered-call capacity.

### Incomplete basis

**Given** multiple lots and at least one lot with missing basis,
**when** the holding is displayed,
**then** basis is marked incomplete and no partial-lot average is represented as the whole-holding basis.

### Portfolio/Screener parity

**Given** a single successful normalized snapshot,
**when** Portfolio and Covered Call capacity consume it,
**then** they report the same share quantity, existing exposure, reservations, and snapshot timestamp.

### Data failure

**Given** positions load but working orders do not,
**when** capacity is requested,
**then** coverage-dependent actions fail closed with an explicit reason.

### Idempotency

**Given** the same broker snapshot is processed repeatedly,
**then** no duplicate equity or option positions are created.

## Implementation notes

- Introduce a shared acquisition/normalization boundary rather than extending the current option-only grouping function indefinitely.
- Adapt current `buildCoveredCallCapacityReport()` logic to consume the normalized snapshot or a canonical adapter.
- Keep raw broker payloads available for diagnostics without allowing them to leak throughout the UI.
- Define equity contribution to portfolio exposure separately from option-only Greeks.

## Validation

- Unit tests for equity normalization, lots, basis completeness, direction, and accounts.
- Integration tests for shared snapshot consumers.
- Existing Portfolio and Covered Call suites.
- `npx tsc --noEmit --incremental false`.
- Full test suite and `git diff --check`.

## Rollout

- Feature-flag equity display and shared snapshot consumption independently.
- Compare old and new Covered Call capacity in shadow mode before switching the scanner.
- Log parity differences with account identifiers redacted.
