# TE-0003 — Implement Task Manager Foundation

**Status:** Ready for Implementation  
**Branch:** `feature/autopilot-paper-mode`

## Objective

Implement the client-side Task Manager foundation for Trade Edge.

This ticket creates the infrastructure required for long-running background operations but must not change the behavior of any existing feature.

## Required Reading

Claude must read these first:

- `docs/tickets/TE-0001-background-task-manager.md`
- `docs/tickets/TE-0002-task-manager-and-command-bus-architecture.md`
- `docs/decisions/ADR-0001-background-task-manager.md`
- `docs/decisions/ADR-0002-command-bus-task-manager-separation.md`

## Scope

Implement only the Task Manager.

Do not implement:

- Command Bus
- Ranked Scan migration
- Screener migration
- Portfolio AI integration
- Autopilot integration
- Browser notifications
- Server-side workers
- Redis
- Background queues

## Required Files

Create these files:

- `lib/tasks/task-types.ts`
- `lib/tasks/task-manager.ts`
- `lib/tasks/task-store.ts`
- `lib/tasks/task-events.ts`
- `components/tasks/TaskProvider.tsx`
- `hooks/useTaskManager.ts`
- `hooks/useTask.ts`

## Task Model

Each task must support:

- `id`
- `title`
- `kind`
- `status`
- `progressPct`
- `progressLabel`
- `input`
- `result`
- `error`
- `createdAt`
- `startedAt`
- `completedAt`
- `cancelledAt`

Supported statuses:

- `queued`
- `running`
- `completed`
- `failed`
- `cancelled`

## Store Responsibilities

Implement an in-memory task registry supporting:

- `createTask()`
- `startTask()`
- `updateTask()`
- `updateProgress()`
- `completeTask()`
- `failTask()`
- `cancelTask()`
- `removeTask()`
- `getTask()`
- `getAllTasks()`

## Event System

Implement lightweight dependency-free publish/subscribe events:

- `task-created`
- `task-started`
- `task-progress`
- `task-completed`
- `task-failed`
- `task-cancelled`
- `task-removed`

## TaskProvider

Create a React provider that:

- Mounts once at the application root.
- Provides access through React Context.
- Does not render visible UI.
- Does not modify existing app behavior.

## Hooks

Implement:

- `useTaskManager()`
- `useTask(taskId)`

## Out of Scope

Do not:

- Add Task Center UI
- Add toast notifications
- Modify existing screens
- Convert Ranked Scan
- Convert Screener
- Implement Command Bus
- Add persistence
- Add browser notifications

## Validation

Run:

- `npm run build`
- `npm run lint` if available

## Git Commit

Commit with:

`feat(tasks): implement task manager foundation`

## Claude Instructions

Stay strictly within TE-0003.

When finished, report:

- Files changed
- Validation results
- Assumptions
- Deferred work
- Risks or follow-up recommendations
