# Trade Edge System Map

## Purpose

This document maps the major Trade Edge subsystems so implementation work has a clear target architecture.

## Working Roles

- Paul: Product Owner
- Quinn: Chief Architect
- Dean: Lead Engineer / Implementation Lead

*(Updated 2026-07-24, DOC-0001. Previously: "Dean: Product Owner / Trader," "ChatGPT: Chief Architect / Reviewer," "Claude: Implementation Engineer" — same functional roles, formalized under the TradeEdge Engineering Operating Model.)*

## High-Level Domains

```text
Trade Edge
├── Portfolio
├── Engine / Screener
├── Trade Log
├── Performance
├── Autopilot / Paper Mode
└── Infrastructure
```

## Infrastructure

```text
Infrastructure
├── Task Manager
│   ├── lib/tasks/
│   ├── components/tasks/
│   └── hooks/useTaskManager.ts
├── Command Bus
│   ├── lib/commands/
│   ├── components/commands/
│   └── hooks/useCommandBus.ts
├── Future Notifications
└── Future Durable Background Tasks
```

## Screener / Engine

```text
Screener
├── app/screener/page.tsx
├── lib/scans/
│   ├── shared scan helpers
│   └── ranked scan runner
└── features/screener/
    ├── components/
    ├── hooks/
    ├── services/
    └── types.ts
```

## Current Screener Modernization Goal

Reduce `app/screener/page.tsx` from a monolithic route file into a route orchestrator that delegates to feature modules.

Initial target:

```text
features/screener/
├── components/
│   ├── RankedScanPanel.tsx
│   ├── RankedToolbar.tsx
│   ├── RankedProgress.tsx
│   └── RankedResultsTable.tsx
├── hooks/
│   └── useRankedScan.ts
└── types.ts
```

## Portfolio

```text
Portfolio
├── Positions
├── Lifecycle
├── Wheel / Covered Call workflows
├── AI Recommendations
└── Future risk/rules engine
```

## Autopilot / Paper Mode

```text
Autopilot
├── Paper-mode commands
├── Reviewable recommendations
├── Simulated actions
├── Audit trail
└── Future durable execution
```

## Dependency Direction

Preferred dependency direction:

```text
app/ routes
  -> features/
    -> lib/
      -> shared utilities

components/
  -> lib/ when needed

lib/
  -> should not import feature modules unless explicitly approved
```

## Current Milestones

### Milestone 1 — Platform Foundation

Completed:

- TE-0001
- TE-0002
- TE-0003
- TE-0004
- TE-0005A

### Milestone 2 — Screener Modernization

Current:

- RF-0001 — Establish feature-oriented Screener module

Next:

- TE-0005B — Global Ranked Scan completion notifications
- TE-0006 — Background Screener
