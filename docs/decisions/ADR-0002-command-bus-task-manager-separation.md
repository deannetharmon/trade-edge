# ADR-0002 Command Bus and Task Manager Separation

## Status

Proposed

## Context

Trade Edge is moving toward background scans, portfolio AI review, and Autopilot Paper Mode. These workflows involve both user intent and long-running execution state.

If the app treats every workflow as only a task, then task objects will gradually absorb product intent, execution state, UI routing, AI decision context, and future trading action semantics. That would make the system harder to extend and harder to keep safe.

We need a clear architecture boundary before implementation begins.

## Decision

Separate Trade Edge workflow architecture into two layers:

1. **Command Bus**: accepts and routes intent.
2. **Task Manager**: owns execution state for long-running work.

The Command Bus decides which handler should respond to an action request. The Task Manager tracks the lifecycle of work after it has been created.

## Rationale

Commands and tasks answer different questions.

A command answers:

- What did the user, system, AI, or autopilot ask Trade Edge to do?
- What handler should receive that request?
- Should this request create a task?

A task answers:

- What work is running?
- What is its current status?
- Did it complete, fail, or get cancelled?
- Where is the result?

Keeping these separate prevents Autopilot Paper Mode from becoming tightly coupled to UI-specific scan execution details.

## Consequences

### Positive

- Cleaner path from manual user actions to AI/autopilot initiated actions.
- Reusable background task infrastructure.
- Better safety boundary for paper-mode versus future live-trading behavior.
- Easier audit trail for generated recommendations and simulated actions.
- Less page-level state duplication.

### Negative / trade-offs

- Slightly more upfront architecture.
- Requires discipline to keep business intent out of task objects.
- Requires command handlers to remain small and understandable.

## Guardrails

- The Command Bus must not become a hidden live-trading execution layer.
- All Autopilot commands must remain paper-mode only until a later explicit product decision changes that.
- Task results must identify whether they are recommendations, simulations, or future approved execution records.
- A task can be started by AI/autopilot, but user-visible review state must remain clear.

## Initial command examples

```ts
START_RANKED_SCAN
START_SCREENER_SCAN
RUN_PORTFOLIO_AI_REVIEW
START_AUTOPILOT_PAPER_RUN
CANCEL_TASK
OPEN_TASK_RESULT
```

## Initial task examples

```ts
ranked-scan
screener-scan
portfolio-analysis
autopilot-paper-run
```

## Implementation notes

Start with a client-side command bus and task manager. Do not add server queues or durable workers in the first implementation.

Mount the Task Provider at the app shell/root level so tasks survive in-app navigation.

Expose command dispatch and task state through hooks rather than page-level imports where practical.

## Validation

For this ADR:

```bash
sed -n '1,260p' docs/decisions/ADR-0002-command-bus-task-manager-separation.md
```

For later implementation:

- Start a ranked scan from a page-level command.
- Confirm command handler creates a task.
- Navigate away from the page.
- Confirm Task Manager still owns task status.
- Confirm Task Center/toast receives updates.

## Follow-ups

- TE-0003 should implement Task Manager provider/hooks.
- TE-0004 should implement Command Bus and first command handlers.
- A later ADR should decide if and when server-backed durable command/task execution is necessary.
