# TE-0004 — Implement Command Bus Foundation

**Status:** Ready for Implementation
**Branch:** `feature/autopilot-paper-mode`

## Objective

Implement the client-side Command Bus foundation for Trade Edge.

TE-0003 created the Task Manager foundation, which tracks long-running work. TE-0004 adds the separate command layer that accepts intent and routes that intent to small handlers.

This ticket is infrastructure only. It must not change existing user-facing behavior.

## Required Reading

Claude must read these first:

- `docs/tickets/TE-0001-background-task-manager.md`
- `docs/tickets/TE-0002-task-manager-and-command-bus-architecture.md`
- `docs/tickets/TE-0003-implement-task-manager-foundation.md`
- `docs/decisions/ADR-0001-background-task-manager.md`
- `docs/decisions/ADR-0002-command-bus-task-manager-separation.md`

Claude should also inspect the TE-0003 implementation before starting:

- `lib/tasks/task-types.ts`
- `lib/tasks/task-manager.ts`
- `components/tasks/TaskProvider.tsx`
- `hooks/useTaskManager.ts`
- `hooks/useTask.ts`
- `app/providers.tsx`

## Scope

Implement only the Command Bus foundation.

Do not migrate existing features to the Command Bus in this ticket.

## Required Files

Create:

- `lib/commands/command-types.ts`
- `lib/commands/command-bus.ts`
- `lib/commands/command-handlers.ts`
- `components/commands/CommandProvider.tsx`
- `hooks/useCommandBus.ts`

Update only if needed:

- `app/providers.tsx`

If `app/providers.tsx` is updated, preserve all existing providers and only add `CommandProvider` safely around the current provider tree.

## Command Types

Required command types:

- `START_RANKED_SCAN`
- `START_SCREENER_SCAN`
- `RUN_PORTFOLIO_AI_REVIEW`
- `START_AUTOPILOT_PAPER_RUN`
- `CANCEL_TASK`
- `OPEN_TASK_RESULT`

Required command source values:

- `user`
- `system`
- `ai`
- `autopilot`

Suggested type shape:

- `TradeEdgeCommandType`
- `TradeEdgeCommandSource`
- `TradeEdgeCommand<TPayload>`
- `TradeEdgeCommandResult<TResult>`
- `TradeEdgeCommandHandler<TPayload, TResult>`

## Command Bus Responsibilities

The Command Bus must support:

- `dispatch(commandInput)`
- `registerHandler(commandType, handler)`
- unsubscribe return from handler registration
- `getRegisteredCommandTypes()`

The Command Bus should:

- Generate command IDs.
- Add `createdAt` timestamps.
- Default `source` to `user` if not provided.
- Route commands to registered handlers.
- Return a typed command result.
- Return a safe unhandled result when no handler exists.
- Avoid throwing for normal unhandled commands.
- Be dependency-free.
- Stay independent from React whenever practical.

## Provider and Hook

Create:

- `CommandProvider`
- `useCommandBus()`

Requirements:

- Provider mounts once near the app root.
- Provider renders no visible UI.
- Hook exposes `dispatch`, `registerHandler`, and registered command types if practical.
- Provider preserves the existing `TaskProvider`.
- No visible app behavior changes.

## Relationship to Task Manager

The Command Bus does not replace the Task Manager.

Command Bus answers:

- What should happen?

Task Manager answers:

- What is happening now?

TE-0004 may create the structure that lets future command handlers create tasks, but it should not migrate actual workflows yet.

## Guardrails

Do not:

- Add trading execution behavior.
- Add new trading workflows.
- Implement Autopilot behavior.
- Implement paper-mode run logic.
- Create server-side workers, queues, Redis, or persistence.
- Modify existing app flows.
- Add visible UI.

## Acceptance Criteria

- Required command files exist.
- `CommandBus` compiles.
- `CommandProvider` compiles.
- `useCommandBus()` compiles.
- Existing `TaskProvider` remains wired.
- Existing app behavior is unchanged.
- No visible UI changes are introduced.
- Build passes.

## Validation

Run:

- `npm run build`
- `npm run lint` if available and currently working

Manual smoke test:

1. Open the app.
2. Confirm login/session still works.
3. Navigate through main Trade Edge tabs.
4. Confirm no blank pages.
5. Confirm no visible UI changes.
6. Confirm browser console has no new provider/context errors.

## Git Commit

After validation:

`git add lib/commands components/commands hooks/useCommandBus.ts app/providers.tsx docs/tickets/TE-0004-implement-command-bus-foundation.md docs/tickets/README.md`

`git commit -m "feat(commands): implement command bus foundation"`

`git push origin feature/autopilot-paper-mode`

Do not commit temporary helper scripts.

## Claude Completion Report

When finished, report:

- Files changed
- Provider wiring changes
- Validation results
- Assumptions made
- Deferred work
- Risks or follow-up recommendations
