# Trade Edge Roadmap

## Current Branch

`feature/autopilot-paper-mode`

## Completed

- TE-0001 — Background Task Manager Requirements
- TE-0002 — Task Manager and Command Bus Architecture
- TE-0003 — Implement Task Manager Foundation
- TE-0004 — Implement Command Bus Foundation

## Next Up

### TE-0005 — Migrate Ranked Scan to Task Manager and Command Bus

Goal: convert Ranked Scan into the first real consumer of the Task Manager and Command Bus foundations.

This will validate:

- command dispatch ergonomics
- task lifecycle updates
- background-safe scan execution
- result handoff after navigation
- provider wiring
- current architectural boundaries

## Near-Term Roadmap

1. TE-0005 — Migrate Ranked Scan to Task Manager and Command Bus
2. TE-0006 — Migrate Screener to Task Manager and Command Bus
3. TE-0007 — Add Global Task Center and Notifications
4. TE-0008 — Portfolio AI Recommendation Improvements
5. TE-0009 — Autopilot Paper Mode Integration
6. TE-0010 — Evaluate Durable Background Tasks

## Working Model

- Dean: Product Owner / Trader
- ChatGPT: Chief Architect / Reviewer
- Claude: Implementation Engineer

## Process

1. Product owner defines priority.
2. Architect creates TE ticket and ADR if needed.
3. Implementation engineer implements one ticket.
4. Implementation engineer creates an implementation report.
5. Architect reviews before moving to the next ticket.
