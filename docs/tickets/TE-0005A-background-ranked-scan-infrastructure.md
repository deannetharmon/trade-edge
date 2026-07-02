# TE-0005A — Background Ranked Scan Infrastructure

**Status:** Ready for Implementation  
**Branch:** `feature/autopilot-paper-mode`

## Objective

Migrate Ranked Scan execution onto the existing Task Manager and Command Bus foundation so a ranked scan can continue running when the user navigates away from the Ranked Scan page.

This is the first real integration of TE-0003 and TE-0004.

## Required Reading

Claude must read these first:

- `docs/tickets/TE-0001-background-task-manager.md`
- `docs/tickets/TE-0002-task-manager-and-command-bus-architecture.md`
- `docs/tickets/TE-0003-implement-task-manager-foundation.md`
- `docs/tickets/TE-0004-implement-command-bus-foundation.md`
- `docs/decisions/ADR-0001-background-task-manager.md`
- `docs/decisions/ADR-0002-command-bus-task-manager-separation.md`
- `docs/decisions/ADR-0003-ranked-scan-cancellation.md`

Claude should also inspect the current Ranked Scan implementation before making changes.

## User Story

As a Trade Edge user, I want a Ranked Scan to keep running when I navigate to another Trade Edge page so I can continue working and return to the scan later without losing progress.

## Scope

Implement only Ranked Scan background execution infrastructure.

This ticket should:

- Create a `START_RANKED_SCAN` command handler.
- Create a `ranked-scan` task when the command is dispatched.
- Run the existing Ranked Scan logic from the task workflow instead of page-local component state.
- Update task progress while the scan runs.
- Store completed scan results on the task.
- Allow the Ranked Scan page to reconnect to an active or completed ranked-scan task.
- Preserve existing Ranked Scan calculation behavior as much as possible.
- Add cancellation support if the existing scan loop can support it safely.

## Non-Goals

Do not:

- Add global notifications.
- Add Task Center UI.
- Add browser notifications.
- Migrate Screener.
- Migrate Portfolio AI.
- Modify Autopilot.
- Add server workers, Redis, queues, or persistence.
- Change ranking formulas unless required to preserve existing behavior.
- Add live trading behavior.

## Expected User Flow

1. User opens the Ranked Scan page.
2. User clicks the existing Ranked Scan action.
3. The page dispatches `START_RANKED_SCAN`.
4. Command handler creates a `ranked-scan` task.
5. Task status becomes `running`.
6. User navigates to another Trade Edge page.
7. Scan continues because execution is owned by app-level services, not the page component.
8. User returns to Ranked Scan page.
9. Page reconnects to the active task.
10. When the scan completes, task status becomes `completed`.
11. Results remain available in task memory.

## Architecture Flow

```text
Ranked Scan Page
    |
    v
CommandBus.dispatch(START_RANKED_SCAN)
    |
    v
Ranked Scan Command Handler
    |
    v
TaskManager.createTask(kind: ranked-scan)
    |
    v
Ranked Scan Runner / Engine
    |
    v
TaskManager.updateProgress(...)
    |
    v
TaskManager.completeTask(result)
```

## Implementation Requirements

### 1. Identify the Ranked Scan entry point

Find the current Ranked Scan page/action and identify:

- where the scan is started
- where scan state is stored
- where loading/progress state is stored
- where results are stored
- whether scan logic is embedded in a component

Preserve existing behavior while moving execution ownership out of page-local state.

### 2. Create a Ranked Scan runner if needed

If the scan logic currently lives inside a React component, extract the reusable execution logic into a plain TypeScript runner.

Suggested location:

- `lib/scans/ranked-scan-runner.ts`

The runner should accept:

- scan input/options
- progress callback
- abort signal or cancellation checker if practical

The runner should return the same result shape the page already expects.

### 3. Register command handler

Update `lib/commands/command-handlers.ts` or the current command handler registration point to support `START_RANKED_SCAN`.

The handler should:

- create a ranked-scan task
- start the task
- execute the ranked scan asynchronously
- update progress
- complete/fail/cancel the task
- return a command result containing the `taskId`

### 4. Preserve provider boundaries

Do not merge Command Bus and Task Manager.

It is acceptable to wire the command handler with access to TaskManager through provider setup or a small service registration layer, but keep responsibilities separated:

- Command Bus routes intent.
- Task Manager owns task state.
- Ranked Scan runner owns scan calculation/execution.

### 5. Page reconnect behavior

The Ranked Scan page should:

- know the active ranked-scan task ID if the user started one
- reconnect to the active task when remounted if a ranked-scan task is running
- display existing loading/progress UI based on task state where practical
- display completed task results using the existing results UI

For this ticket, memory-only task results are acceptable.

### 6. Cancellation

If practical, add support for cancellation using `AbortController` or an equivalent cancellation check.

Cancellation semantics are defined in ADR-0003.

If full cancellation is not practical without risky refactoring, implement the clean API boundary and document the limitation in the implementation report.

## Acceptance Criteria

- `START_RANKED_SCAN` is handled by the Command Bus.
- Starting Ranked Scan creates a `ranked-scan` task.
- Ranked Scan execution is not owned solely by the page component.
- Navigating away from the Ranked Scan page does not stop the scan.
- Returning to the Ranked Scan page reconnects to the active task.
- Completed results remain available in task memory.
- Existing Ranked Scan result behavior is preserved.
- Build passes.
- No global notifications are added yet.
- No Task Center UI is added yet.

## Validation

Run:

- `npm run build`
- `npm run lint` if available and currently working

Manual smoke test:

1. Open Trade Edge.
2. Start Ranked Scan.
3. Navigate to Portfolio or another tab while scan is running.
4. Wait briefly.
5. Return to Ranked Scan.
6. Confirm scan is still running or completed.
7. Confirm results render correctly after completion.
8. Confirm no blank pages.
9. Confirm browser console has no new provider/context/runtime errors.

## Git Commit

After validation:

```bash
git add .
git commit -m "feat(scans): run ranked scan as background task"
git push origin feature/autopilot-paper-mode
```

Do not commit temporary helper scripts.

## Claude Completion Report

After implementation, create:

- `docs/reviews/TE-0005A-Implementation-Report.md`

The report must include:

- Executive summary
- Files changed
- Architecture decisions
- Public API changes
- Ranked Scan flow before and after
- Provider/handler wiring changes
- Build results
- Manual smoke test results
- Diff statistics
- Technical debt
- Recommendations before TE-0005B
