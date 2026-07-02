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
- TE-0005C — Task Completion Notifications

## Current Focus

### TE-0005D — Global Task Drawer

Goal: provide a compact global drawer for viewing running and recent background tasks.

This is the final task-UX infrastructure ticket before shifting back to trader-facing features.

## Near-Term Roadmap

1. TE-0005D — Global Task Drawer
2. TE-0006 — Portfolio AI Recommendation Engine 2.0
3. TE-0007 — Position Health and Exit Advisor
4. TE-0008 — Retirement Income Engine
5. TE-0009 — Autopilot Paper Mode
6. TE-0010 — Performance Analytics

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
- TE-0005C

Current:

- TE-0005D

### Milestone 3 — Trader Intelligence

Planned:

- TE-0006 — Portfolio AI Recommendation Engine 2.0
- TE-0007 — Position Health and Exit Advisor
- TE-0008 — Retirement Income Engine

### Milestone 4 — Autopilot / Paper Mode

Planned:

- TE-0009+

### Milestone 5 — Production Hardening

Planned:

- TE-0010+

## Working Model

- Dean: Product Owner / Trader
- ChatGPT: Chief Architect / Reviewer
- Claude/Gemini: Implementation Engineer
- Vercel: authoritative build validation after push

## Process

1. Product owner defines priority.
2. Architect creates TE/RF ticket and ADR if needed.
3. Implementation engineer implements one ticket.
4. Implementation engineer creates an implementation report.
5. Vercel build validates after push.
6. Architect reviews before moving to the next ticket.
