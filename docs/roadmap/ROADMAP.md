# Trade Edge Roadmap

## Current Branch

`feature/autopilot-paper-mode`

## Completed

- TE-0001 — Background Task Manager Requirements
- TE-0002 — Task Manager and Command Bus Architecture
- TE-0003 — Implement Task Manager Foundation
- TE-0004 — Implement Command Bus Foundation
- TE-0005A — Background Ranked Scan Infrastructure

## Current Focus

### RF-0001 — Establish Feature-Oriented Screener Module

Goal: begin decomposing the large Screener route by extracting Ranked Scan UI into `features/screener/` while preserving behavior.

This validates:

- feature-oriented folder architecture
- route-as-orchestrator pattern
- safe refactoring around the Screener
- maintainability before adding notifications and more background workflows

## Near-Term Roadmap

1. RF-0001 — Establish Feature-Oriented Screener Module
2. TE-0005B — Global Ranked Scan Completion Notification
3. TE-0005C — Resume Completed Ranked Scan Results
4. TE-0006 — Migrate Screener to Task Manager and Command Bus
5. TE-0007 — Add Global Task Center and Notifications
6. TE-0008 — Portfolio AI Recommendation Improvements
7. TE-0009 — Autopilot Paper Mode Integration
8. TE-0010 — Evaluate Durable Background Tasks

## Milestones

### Milestone 1 — Platform Foundation

Completed:

- TE-0001
- TE-0002
- TE-0003
- TE-0004
- TE-0005A

### Milestone 2 — Screener Modernization

Current:

- RF-0001

Next:

- TE-0005B
- TE-0005C
- TE-0006
- TE-0007

### Milestone 3 — Portfolio Intelligence

Planned:

- TE-0008+

### Milestone 4 — Autopilot / Paper Mode

Planned:

- TE-0009+

### Milestone 5 — Production Hardening

Planned:

- TE-0010+

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
