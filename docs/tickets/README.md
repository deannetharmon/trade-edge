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

- [LEAPS-FLOW-0001 Broker-first Standalone LEAPS Discovery and Execution](./LEAPS-FLOW-0001-broker-first-standalone-leaps.md)
- [SCREENER-CONFIG-0001 Strategy-Aware Scan Configuration](./SCREENER-CONFIG-0001-unified-scan-configuration.md)
- [SCAN-ALIGN-0001 Align Covered-Call and PMCC Short-Call Rules](./SCAN-ALIGN-0001-covered-call-and-pmcc-rules.md)
- [PMCC-HELD-BREAKEVEN-0001 Held-LEAP Short Calls Have No Breakeven Floor (P1)](./PMCC-HELD-BREAKEVEN-0001-held-leap-short-call-floor.md)
- [PMCC-EARNINGS-PAST-0001 PMCC Earnings Warning Fires on Past Dates (P2)](./PMCC-EARNINGS-PAST-0001-past-earnings-false-warning.md)
- [SCAN-ALIGN-0001C1 OI Policy (accepted, build slot 3)](./SCAN-ALIGN-0001C1-oi-policy.md)
- [SCAN-ALIGN-0001C2 Hybrid Bid/Ask and Ceiling (accepted, build slot 4)](./SCAN-ALIGN-0001C2-hybrid-bid-ask-and-ceiling.md)
- [SCAN-ALIGN-0001D PMCC Earnings Removal and After-Expiry Warning (accepted, build slot 5)](./SCAN-ALIGN-0001D-pmcc-earnings-removal.md)
- [SCAN-ALIGN-0001E Debit Below Width Always On (accepted, build slots 6-7)](./SCAN-ALIGN-0001E-debit-below-width-always-on.md)
- [SCAN-ALIGN-0001F PMCC Short Delta: Control Polish and Rule Flip (F1 accepted, F2 held)](./SCAN-ALIGN-0001F-pmcc-short-delta.md)
- [PMCC-HELD-LONG-FLAGGED-0001 Held LEAPs That Go OTM Should Be Flagged, Not Dropped (draft)](./PMCC-HELD-LONG-FLAGGED-0001-held-leap-dropped-silently.md)
- [PMCC-ASSIGNMENT-RISK-0001 Ex-Dividend Assignment Risk and Short-to-LEAP Expiry Gap (draft)](./PMCC-ASSIGNMENT-RISK-0001-ex-dividend-and-expiry-gap.md)
- [EARNINGS-NO-DATE-0001 Missing Earnings Date Caution (draft)](./EARNINGS-NO-DATE-0001-missing-earnings-date-caution.md)
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

## Current roadmap order

1. Stabilize current build.
2. Define task/command architecture.
3. Implement client-side Task Manager.
4. Implement Command Bus.
5. Migrate Ranked Scan / Screener to background tasks.
6. Add Task Center and global completion notifications.
7. Wire Autopilot Paper Mode through paper-only commands.
