# Trade Edge Tickets

This folder contains implementation-ready tickets for Trade Edge.

## Ticket format

Each ticket should include:

- Problem
- User value
- Scope
- Non-goals
- Acceptance criteria
- Implementation notes
- Validation steps
- Rollout notes

## LCC-0001 — Equity-Aware LEAPS, Covered Call, and PMCC Lifecycle

- [Epic and cross-ticket invariants](./LCC-0001-equity-aware-leaps-covered-call-pmcc-epic.md)
- [Execution sequence and gates](./LCC-0001-execution-sequence.md)
- [Review index](./LCC-0001-review-index.md)
- [LCC-0001A Unified Portfolio Snapshot and Equity Holdings](./LCC-0001A-unified-portfolio-snapshot-equity-holdings.md)
- [LCC-0001B Coverage Allocations and Strategy Composition](./LCC-0001B-coverage-allocations-strategy-composition.md)
- [LCC-0001C Position Entry and Management Workflows](./LCC-0001C-position-entry-management-workflows.md)
- [LCC-0001D Lifecycle, Reconciliation, and Migration](./LCC-0001D-lifecycle-reconciliation-migration.md)
- [LCC-0001E Scanner Reframing](./LCC-0001E-scanner-reframing.md)

Execution order:

```text
LCC-0001A → LCC-0001B → LCC-0001C → LCC-0001D → LCC-0001E
```

## Active tickets

- [TE-0001 Background Task Manager](./TE-0001-background-task-manager.md)
- [TE-0002 Task Manager and Command Bus Architecture](./TE-0002-task-manager-and-command-bus-architecture.md)
- [TE-0003 Implement Task Manager Foundation](./TE-0003-implement-task-manager-foundation.md)
- [TE-0004 Implement Command Bus Foundation](./TE-0004-implement-command-bus-foundation.md)
- [TE-0005A Background Ranked Scan Infrastructure](./TE-0005A-background-ranked-scan-infrastructure.md)
- [RF-0001 Feature-Oriented Screener Module](./RF-0001-feature-oriented-screener-module.md)
- [TE-0005B Global Background Task Status Bar](./TE-0005B-global-background-task-status-bar.md)
- [TE-0005C Task Completion Notifications](./TE-0005C-task-completion-notifications.md)
- [TE-0005D Global Task Drawer](./TE-0005D-global-task-drawer.md)
- [TE-0006A Portfolio Health Scoring Framework](./TE-0006A-portfolio-health-scoring-framework.md)
- [TE-0006B Portfolio Recommendation Rules](./TE-0006B-portfolio-recommendation-rules.md)
- [POSITIONS-0004 Profit-Protecting Credit-Spread Stop Adjustments](./POSITIONS-0004-profit-protecting-credit-spread-stops.md)
- [POSITIONS-0005 Standalone LEAPS Reviewed Stop](./POSITIONS-0005-standalone-leaps-reviewed-stop.md)
- [TRADELOG-0002 Order Lifecycle History for Cancellations and Rolls](./TRADELOG-0002-order-lifecycle-cancel-roll-history.md)

## Proposed entry-quality sequence

- [ENTRY-0001A Credit-Spread Entry Snapshot Foundation](./ENTRY-0001A-credit-spread-entry-snapshot-foundation.md)
- [ENTRY-0001 Credit-Spread Entry Context and Advisory Risk Signals](./ENTRY-0001-credit-spread-entry-context.md)
- [ENTRY-0002 Credit-Spread Entry Snapshot Performance Analysis](./ENTRY-0002-credit-spread-entry-performance-analysis.md)
- [Quinn’s live filled-OTO verification](../reviews/ENTRY-0001A-live-filled-oto-verification.md)

Execution order:

```text
ENTRY-0001A → ENTRY-0001 → collect complete closed-trade cohort → ENTRY-0002
```

Current gate: Quinn verifies one already-filled OTO through a read-only Trade Log refresh. No additional order action is required.

## Current roadmap order

1. Stabilize current build.
2. Define task/command architecture.
3. Implement client-side Task Manager.
4. Implement Command Bus.
5. Migrate Ranked Scan / Screener to background tasks.
6. Add Task Center and global completion notifications.
7. Wire Autopilot Paper Mode through paper-only commands.
