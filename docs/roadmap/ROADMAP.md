# Trade Edge Roadmap

## Current Branch

`feature/autopilot-paper-mode`

## Completed

- TE-0001 — Background Task Manager Requirements
- TE-0002 — Task Manager and Command Bus Architecture
- TE-0003 — Implement Task Manager Foundation
- TE-0004 — Implement Command Bus Foundation
- TE-0005A — Background Ranked Scan Infrastructure
- RF-0001 — Establish Feature-Oriented Screener Module
- TE-0005B — Global Background Task Status Bar

## Current Focus

### TE-0005C — Task Completion Notifications

Goal: add lightweight app-wide in-app notifications when background tasks complete, fail, or cancel.

This validates:

- TaskManager event subscription UX
- terminal task notification handling
- Open Results from notification
- notification dismissal without destroying task records

## Near-Term Roadmap

1. TE-0005C — Task Completion Notifications
2. TE-0005D — Task Center
3. TE-0006 — Migrate Screener to Task Manager and Command Bus
4. TE-0007 — Portfolio AI Recommendation Improvements
5. TE-0008 — Autopilot Paper Mode Integration
6. TE-0009 — Evaluate Durable Background Tasks

## Milestones

### Milestone 1 — Platform Foundation

Completed:

- TE-0001
- TE-0002
- TE-0003
- TE-0004
- TE-0005A

### Milestone 2 — Screener Modernization and Task UX

Completed:

- RF-0001
- TE-0005B

Current:

- TE-0005C

Next:

- TE-0005D
- TE-0006

### Milestone 3 — Portfolio Intelligence

Planned:

- TE-0007+

### Milestone 4 — Autopilot / Paper Mode

Planned:

- TE-0008+

### Milestone 5 — Production Hardening

Planned:

- TE-0009+

## Working Model

- Dean: Product Owner / Trader
- ChatGPT: Chief Architect / Reviewer
- Claude: Implementation Engineer

## Process

1. Product owner defines priority.
2. Architect creates TE/RF ticket and ADR if needed.
3. Implementation engineer implements one ticket.
4. Implementation engineer creates an implementation report.
5. Architect reviews before moving to the next ticket.
