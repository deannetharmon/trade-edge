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

## Current roadmap order

1. Stabilize current build.
2. Define task/command architecture.
3. Implement client-side Task Manager.
4. Implement Command Bus.
5. Migrate Ranked Scan / Screener to background tasks.
6. Add Task Center and global completion notifications.
7. Wire Autopilot Paper Mode through paper-only commands.
