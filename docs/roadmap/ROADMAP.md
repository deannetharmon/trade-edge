# Trade Edge Roadmap

## Current Branch

`feature/autopilot-paper-mode`

## Completed

- TE-0001 — Background Task Manager Requirements
- TE-0002 — Task Manager and Command Bus Architecture
- TE-0003 — Implement Task Manager Foundation
- TE-0004 — Implement Command Bus Foundation

## Current Focus

### TE-0005A — Background Ranked Scan Infrastructure

Goal: make Ranked Scan the first real consumer of the Task Manager and Command Bus foundations.

This ticket validates:

- command dispatch ergonomics
- task lifecycle updates
- background-safe scan execution
- result handoff after navigation
- cancellation boundaries
- current architectural boundaries

## Near-Term Roadmap

1. TE-0005A — Background Ranked Scan Infrastructure
2. TE-0005B — Global Ranked Scan Completion Notification
3. TE-0005C — Resume Completed Ranked Scan Results
4. TE-0006 — Migrate Screener to Task Manager and Command Bus
5. TE-0007 — Add Global Task Center and Notifications
6. TE-0008 — Portfolio AI Recommendation Improvements
7. TE-0009 — Autopilot Paper Mode Integration
8. TE-0010 — Evaluate Durable Background Tasks

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
