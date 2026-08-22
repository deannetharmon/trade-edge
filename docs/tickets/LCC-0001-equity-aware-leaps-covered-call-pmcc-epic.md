# LCC-0001 — Equity-Aware LEAPS, Covered Call, and PMCC Lifecycle

**Status:** Approved for technical specification
**Owner:** Product
**Reviewers:** Alan, Ian, Paul, Quinn, Diane, Dane
**Execution order:** LCC-0001A → LCC-0001B → LCC-0001C → LCC-0001D → LCC-0001E

## Objective

Make TradeEdge aware of the user's actual equity and option holdings, explicitly identify what supports each short call, and support the complete lifecycle of standalone stock, standalone long calls/LEAPS, stock covered calls, buy-writes, and PMCC long-call diagonals.

## Product principle

TradeEdge tracks actual instruments and transactions first, records the support relationship for each short call second, and derives the resulting strategy and lifecycle state from those facts.

## Problem

TradeEdge currently has two incomplete views of the portfolio:

- Covered Call scanning reads unfiltered broker positions and working orders to calculate share capacity.
- Portfolio acquisition filters the broker response to equity and index options, so actual stock holdings are not displayed.
- PMCC discovery assumes the long call and initial short call are normally opened as one combination, while the long call can legitimately exist by itself.
- The application does not yet retain an explicit relationship between a short call and the shares or long call supporting it.
- Rolls, assignments, partial fills, foundation replacement, and repeated short-call cycles require a durable lifecycle model.

## User value

Users can see what they actually own, understand remaining covered-call capacity, open a long call independently, add short calls later, manage repeated income cycles, and reconcile broker events without TradeEdge inventing coverage or strategy intent.

## Delivery tickets

1. [LCC-0001A — Unified Portfolio Snapshot and Equity Holdings](./LCC-0001A-unified-portfolio-snapshot-equity-holdings.md)
2. [LCC-0001B — Coverage Allocations and Strategy Composition](./LCC-0001B-coverage-allocations-strategy-composition.md)
3. [LCC-0001C — Position Entry and Management Workflows](./LCC-0001C-position-entry-management-workflows.md)
4. [LCC-0001D — Lifecycle, Reconciliation, and Migration](./LCC-0001D-lifecycle-reconciliation-migration.md)
5. [LCC-0001E — LEAPS, Covered Call, and PMCC Scanner Reframing](./LCC-0001E-scanner-reframing.md)

The detailed release sequence and gate criteria are in [LCC-0001 Execution Sequence](./LCC-0001-execution-sequence.md).

## Authoritative terminology

- **Equity holding:** an open stock position.
- **Long-call position:** the underlying option instrument.
- **LEAPS:** a classification for a qualifying exchange-listed long-term option, not an instrument type.
- **Foundation:** the shares or long call that supports the strategy.
- **Coverage allocation:** the explicit relationship between a short call and its supporting foundation quantity.
- **Short-call cycle:** one short call from opening through closing, expiration, assignment, or roll.
- **Strategy:** the user-facing grouping derived from positions and relationships.
- **Campaign:** an optional internal term; do not require users to learn it.
- **Covered call:** a short call supported by long shares.
- **PMCC:** a recognized configuration of a long call diagonal; it is not operationally identical to a stock covered call.

## UX source of truth

Diane's approved interactive mockups are included with the tickets:

- [Integrated LEAPS, Covered Call, and PMCC Flow](./mockups/tradeedge-integrated-leaps-flow.html)
- [Final Equity-Aware Portfolio](./mockups/tradeedge-equity-portfolio-revision.html)

The mockups define interaction intent and information hierarchy. They do not override financial invariants, broker evidence, accessibility requirements, or implementation safety gates.

## Cross-ticket invariants

1. Every broker instrument and execution remains independently identifiable.
2. A short call cannot consume more foundation quantity than is available.
3. The same foundation quantity cannot support multiple simultaneous short calls.
4. A PMCC short call must expire before its supporting long call.
5. Linked instruments must share the same underlying and compatible deliverables.
6. Closing a foundation cannot silently leave a linked short call unsupported.
7. A roll cannot overwrite or delete the previous short-call cycle.
8. Strategy classification must be reproducible from instruments and relationships.
9. Relationship changes cannot rewrite transactions or fabricate cash flow.
10. Broker synchronization and migration must be idempotent.
11. Portfolio and Screener must calculate coverage from the same normalized snapshot.
12. Symbol-level and strategy-level P/L must count every instrument exactly once.
13. Premium received remains an opening cash flow and liability until the short call is resolved.
14. Net strategy basis is a management metric and must not be labeled as tax basis.
15. When coverage cannot be verified, TradeEdge fails closed and does not recommend a new covered call.

## Release definition

The epic is complete only when a user can:

1. See actual shares and option positions in Portfolio.
2. See allocated, reserved, available, and remainder share quantities.
3. Hold a long call without an active short call.
4. Open a new PMCC or add a short call to an existing long call.
5. Sell a covered call against verified available shares.
6. Track every short-call cycle independently.
7. Close, expire, roll, assign, and reconcile positions without losing history.
8. Distinguish stock covered calls from PMCC long-call diagonals.
9. Use Find LEAPS, Find Covered Calls, Find PMCCs, and Calls Against My Positions against the shared portfolio model.
10. Migrate existing PMCC records without lost history, duplicate positions, or unexplained P/L changes.

## Non-goals

- Automatic exercise decisions.
- Tax advice or tax-lot optimization.
- Naked-call recommendations.
- Automated roll recommendations without user initiation.
- Portfolio-margin replication.
- Multi-foundation support for a single short-call contract.
- A global navigation or application-shell redesign.
- Replacing the existing Screener, Portfolio, theme, or accent systems.

## Global release gates

- **Domain correctness:** entities, quantities, relationships, and transitions approved.
- **Calculation correctness:** Alan's golden financial examples pass exactly.
- **Migration safety:** production-like data migrates with no duplication or unexplained P/L change.
- **Workflow integrity:** approved happy paths and exception paths are represented.
- **Operational readiness:** feature flags, diagnostics, monitoring, rollback, and reconciliation queues exist.
