# ADR-0001 Background Task Manager

## Status

Proposed

## Context

Trade Edge currently needs long-running scan work to survive in-app navigation. The immediate user need is not full server-side durability; it is that a screener/ranked scan should keep running and notify the user even when they move to another Trade Edge page.

Autopilot Paper Mode will eventually need a stronger task model because paper-trading workflows may involve multiple steps, generated recommendations, simulated orders, monitoring, and reviewable outcomes.

We need a staged architecture that solves the near-term product pain without overbuilding infrastructure too early.

## Decision

Adopt a staged background task architecture.

### Stage 1: client-side app-level task manager

Use a React provider mounted at the app shell/root level to own active and recent tasks.

This provider should:

- Keep task state outside individual page components.
- Allow scans to continue across in-app navigation.
- Expose app-wide task status and completion notifications.
- Store task result references so completed results can be reopened.
- Optionally mirror recent task metadata to `sessionStorage`.

### Stage 2: browser notification and persistence hardening

After Stage 1 is stable, add optional browser notifications and stronger refresh recovery.

This may include:

- Explicit browser notification permission flow.
- `localStorage` or IndexedDB task-history persistence.
- Better recovery messaging after refresh.

### Stage 3: server-backed durable task execution

Only add server-backed queues/workers after the product proves the need.

Potential triggers for Stage 3:

- Tasks must survive browser close.
- Tasks must continue when the user is offline.
- Tasks require scheduled execution.
- Multiple devices must see the same task state.
- Autopilot Paper Mode requires durable audit history.

Possible infrastructure options at that time:

- Vercel-compatible route handlers plus persistent storage.
- Redis-backed queues.
- Database-backed job table.
- External worker service.

## Consequences

### Positive

- Fixes the current navigation problem without unnecessary backend complexity.
- Keeps the first implementation understandable and reviewable.
- Creates a reusable abstraction for scans, portfolio analysis, and Autopilot Paper Mode.
- Reduces risk of losing scan results due to component unmounting.

### Negative / trade-offs

- Stage 1 will not survive browser close.
- Stage 1 will not execute while the browser is fully inactive or closed.
- Refresh recovery may initially be limited.
- A later migration may be needed if Autopilot Paper Mode requires durable execution.

## Guardrails

- Do not connect this to live trading execution.
- Do not silently place trades.
- Do not create server-side automation until explicitly approved in a later ticket/ADR.
- Keep Autopilot Paper Mode reviewable and auditable.
- Treat all generated trading actions as recommendations or paper-mode simulations unless explicitly changed by approved requirements.

## Validation

For the documentation decision:

```bash
sed -n '1,220p' docs/decisions/ADR-0001-background-task-manager.md
```

For the later Stage 1 implementation:

```bash
npm run build
```

Manual validation should include:

1. Start a ranked/screener scan.
2. Navigate away from the original page.
3. Confirm the task continues.
4. Confirm a global completion/failure notification appears.
5. Confirm the completed result can be reopened.

## Follow-ups

- TE-0002 should define the concrete provider/hook/task-store implementation.
- TE-0003 should migrate ranked/screener scans into the task manager.
- A later ADR should decide whether Stage 3 server-backed durability is needed.
