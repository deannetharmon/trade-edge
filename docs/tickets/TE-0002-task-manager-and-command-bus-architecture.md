# TE-0002 Task Manager and Command Bus Architecture

## Status

Proposed

## Owner

Product: Dean Harmon  
Architecture / Review: ChatGPT  
Implementation: Claude

## Priority

High. Complete before implementing the background task manager runtime.

## Problem

TE-0001 defines the need for app-level background tasks. Before implementation, Trade Edge needs a clear boundary between two separate concerns:

1. **Commands**: what the app/user/AI wants to happen.
2. **Tasks**: long-running work that is currently executing or recently completed.

Without this split, Autopilot Paper Mode will likely push business intent, scan execution, UI state, and future trading workflow orchestration into one tangled task abstraction.

## User story

As the Trade Edge product owner, I want a clean architecture for commands and tasks so that scans, portfolio analysis, AI recommendations, and Autopilot Paper Mode can evolve without repeatedly rewriting the workflow layer.

## Scope

Create an implementation-ready architecture specification for:

- Command Bus
- Task Manager
- Task Store
- Task Events
- Global Task Provider
- Task hooks
- Task UI integration points
- Guardrails for paper-mode and future live-trading workflows

This ticket is architecture/design only. Runtime implementation should happen in TE-0003 or later.

## Non-goals

Do not implement code in this ticket.

Do not modify trading recommendation logic.

Do not add server-side durable queues.

Do not add live trading execution.

Do not add browser push notifications yet.

## Architecture decision

Trade Edge should use two separate concepts:

### Command Bus

The Command Bus accepts intent.

Examples:

- `START_RANKED_SCAN`
- `START_SCREENER_SCAN`
- `RUN_PORTFOLIO_AI_REVIEW`
- `START_AUTOPILOT_PAPER_RUN`
- `CANCEL_TASK`
- `OPEN_TASK_RESULT`

The Command Bus answers: **what should happen?**

### Task Manager

The Task Manager owns execution state for work that is running, completed, failed, or cancelled.

Examples:

- Ranked scan running at 72%.
- Portfolio AI review completed.
- Autopilot paper run failed.
- Screener task cancelled.

The Task Manager answers: **what is happening now?**

## Proposed file structure

```txt
lib/commands/
  command-bus.ts
  command-types.ts
  command-handlers.ts

lib/tasks/
  task-manager.ts
  task-types.ts
  task-store.ts
  task-events.ts

components/tasks/
  TaskProvider.tsx
  TaskCenter.tsx
  TaskToast.tsx
  TaskIndicator.tsx

hooks/
  useCommandBus.ts
  useTaskManager.ts
  useTask.ts
```

## Command model

```ts
export type TradeEdgeCommandType =
  | 'START_RANKED_SCAN'
  | 'START_SCREENER_SCAN'
  | 'RUN_PORTFOLIO_AI_REVIEW'
  | 'START_AUTOPILOT_PAPER_RUN'
  | 'CANCEL_TASK'
  | 'OPEN_TASK_RESULT';

export interface TradeEdgeCommand<TPayload = unknown> {
  id: string;
  type: TradeEdgeCommandType;
  payload?: TPayload;
  source: 'user' | 'system' | 'ai' | 'autopilot';
  createdAt: string;
}
```

## Task model

```ts
export type TradeEdgeTaskStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type TradeEdgeTaskKind =
  | 'ranked-scan'
  | 'screener-scan'
  | 'portfolio-analysis'
  | 'autopilot-paper-run';

export interface TradeEdgeTask<TInput = unknown, TResult = unknown> {
  id: string;
  kind: TradeEdgeTaskKind;
  title: string;
  status: TradeEdgeTaskStatus;
  input?: TInput;
  result?: TResult;
  error?: string;
  progressPct?: number;
  progressLabel?: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  cancelledAt?: string;
}
```

## Command-to-task flow

```txt
User / AI / Autopilot
        |
        v
Command Bus
        |
        v
Command Handler
        |
        v
Task Manager
        |
        +--> Task Store
        +--> Task Events
        +--> Task Center
        +--> Task Toast
        +--> Page Result View
```

## Required behaviors

### Command Bus

- Accept commands from UI, system workflows, AI recommendation flows, and future autopilot flows.
- Route each command to a handler.
- Return a task ID when the command creates a task.
- Keep command dispatch small and predictable.
- Do not store long-running task state itself.

### Task Manager

- Create tasks.
- Start tasks.
- Update status/progress.
- Store result/error.
- Cancel active tasks when supported.
- Notify subscribers when status changes.
- Retain recent completed/failed/cancelled tasks for the browser session.

### UI

- Show a global active-task indicator.
- Show completion/failure toasts.
- Provide a Task Center view or panel.
- Let user reopen completed scan results.
- Let user cancel supported active tasks.

## Guardrails

- Commands may create paper-mode simulated actions, but must not place live trades.
- Live trading commands are out of scope and should not be stubbed in casually.
- AI/autopilot command sources must remain reviewable.
- Paper-mode execution should produce auditable task results.
- Task results should distinguish recommendation, simulation, and live execution states if live execution is ever approved later.

## Acceptance criteria

- TE-0002 exists under `docs/tickets/`.
- ADR-0002 exists under `docs/decisions/`.
- The architecture clearly separates Command Bus from Task Manager.
- The proposed file structure is documented.
- Required task and command types are documented.
- Runtime implementation is explicitly deferred to follow-up tickets.

## Validation steps

Documentation-only validation:

```bash
git status
find docs -maxdepth 3 -type f | sort
sed -n '1,260p' docs/tickets/TE-0002-task-manager-and-command-bus-architecture.md
sed -n '1,260p' docs/decisions/ADR-0002-command-bus-task-manager-separation.md
```

Do not run the app build for this documentation-only ticket unless the product owner explicitly asks for it.

## Git workflow

```bash
git checkout feature/autopilot-paper-mode
git pull --ff-only
mkdir -p docs/tickets docs/decisions
# add TE-0002 and ADR-0002
git add docs/tickets/TE-0002-task-manager-and-command-bus-architecture.md docs/decisions/ADR-0002-command-bus-task-manager-separation.md docs/tickets/README.md docs/decisions/README.md
git commit -m "docs: define task manager command bus architecture"
git push origin feature/autopilot-paper-mode
```

## Follow-up tickets

- TE-0003 Implement client-side Task Manager provider and hooks.
- TE-0004 Implement Command Bus and initial command handlers.
- TE-0005 Migrate Ranked Scan to Task Manager.
- TE-0006 Add global Task Center and task notifications.
- TE-0007 Wire Autopilot Paper Mode to Command Bus using paper-only guardrails.
