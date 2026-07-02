# TE-0005B — Global Background Task Status Bar

**Status:** Ready for Implementation  
**Branch:** `feature/autopilot-paper-mode`

## Objective

Add a persistent global Background Task Status Bar that shows active and recently completed background tasks anywhere in Trade Edge.

This is the first user-facing task experience built on the Task Manager foundation.

## Required Reading

Claude must read these first:

- `docs/architecture/Engineering-Principles.md`
- `docs/architecture/System-Map.md`
- `docs/tickets/TE-0003-implement-task-manager-foundation.md`
- `docs/tickets/TE-0004-implement-command-bus-foundation.md`
- `docs/tickets/TE-0005A-background-ranked-scan-infrastructure.md`
- `docs/reviews/TE-0005A-Implementation-Report.md`
- `docs/reviews/RF-0001-Implementation-Report.md`

Claude should inspect:

- `lib/tasks/`
- `components/tasks/TaskProvider.tsx`
- `hooks/useTaskManager.ts`
- `hooks/useTask.ts`
- `app/providers.tsx`
- Ranked Scan task result shape from TE-0005A

## User Story

As a Trade Edge user, I want to see background task progress from anywhere in the app so I can navigate away from a running scan and still know whether it is running, completed, failed, or cancelled.

## Scope

Implement a global Background Task Status Bar.

The status bar should:

- render globally near the app shell/root
- show running tasks
- show recently completed, failed, or cancelled tasks
- show progress percentage when available
- show progress label when available
- support multiple active tasks in compact form
- provide an "Open" action for completed Ranked Scan tasks if the task has results
- provide a dismiss action for terminal tasks
- avoid changing existing page behavior

## Non-Goals

Do not:

- Add browser notifications.
- Add OS-level notifications.
- Add a full Task Center page.
- Add persistent storage.
- Add server-side workers.
- Migrate Screener.
- Change Ranked Scan formulas or behavior.
- Change Portfolio AI.
- Change Autopilot.
- Add live trading behavior.

## Suggested Files

Create:

```text
components/tasks/TaskStatusBar.tsx
components/tasks/TaskStatusItem.tsx
components/tasks/task-status-utils.ts
```

Update if needed:

```text
components/tasks/TaskProvider.tsx
hooks/useTaskManager.ts
app/providers.tsx
features/screener/hooks/useRankedScan.ts
app/screener/page.tsx
```

The exact file split may vary, but keep task status UI under `components/tasks/` because it is global infrastructure, not Screener-specific UI.

## UX Requirements

### Running task

Display:

- task title
- status
- progress percent if available
- progress label if available
- compact progress bar or equivalent visual indicator

Example:

```text
Background Tasks
Running: Ranked Scan 72%
Scanning NVDA...
```

### Multiple running tasks

Display a compact summary:

```text
Background Tasks (3)
Ranked Scan 72%
Portfolio AI 41%
Screener queued
```

### Completed task

Display a completed state briefly until dismissed:

```text
Ranked Scan Complete
Open Results
Dismiss
```

### Failed task

Display a failed state until dismissed:

```text
Ranked Scan Failed
<short error>
Dismiss
```

### Cancelled task

Display cancelled state until dismissed:

```text
Ranked Scan Cancelled
Dismiss
```

## Open Results Behavior

For TE-0005B, support Open Results for completed `ranked-scan` tasks.

Acceptable approaches:

1. Navigate to `/screener` and allow the existing page reconnect logic to display completed Ranked Scan results.
2. If already on `/screener`, reconnect/display results directly through existing task state.

Do not invent a new results page in this ticket.

## Dismiss Behavior

Terminal tasks should be dismissible from the status bar UI.

Preferred implementation:

- Keep task records in TaskManager unless removal is already safe.
- Add local dismissed state in the status bar component for terminal tasks.

If existing TaskManager removal is used, confirm it does not break Ranked Scan result reopening.

## Provider / App Shell Wiring

The status bar should be mounted once globally.

Preferred locations:

- inside `app/providers.tsx` after providers if that works safely
- or inside the app shell/layout if that is the existing convention

Do not break existing providers.

Do not wrap or reorder `SessionProvider`, `TaskProvider`, or `CommandProvider` unless necessary.

## Styling Requirements

Use the existing app styling conventions.

Keep it visually compact and non-disruptive.

Do not introduce a new design system.

Do not add external dependencies.

## Acceptance Criteria

- Global Background Task Status Bar is visible when one or more tasks are running or recently terminal.
- Starting Ranked Scan shows a running task in the global status bar.
- Navigating away from Screener leaves the status bar visible.
- Progress updates are reflected.
- Completion state is shown.
- Failed/cancelled states are shown when applicable.
- Completed Ranked Scan can be opened from the status bar.
- Terminal tasks can be dismissed.
- Existing Ranked Scan behavior remains intact.
- Existing Filter/Targeted behavior remains intact.
- Build passes.
- No temporary scripts are committed.

## Validation

Run:

- `npm run build`
- `npm run lint` if available and currently working

Manual smoke test:

1. Start Ranked Scan.
2. Confirm global status bar appears.
3. Navigate away from Screener.
4. Confirm task status remains visible.
5. Return to Screener or use Open Results.
6. Confirm completed results display.
7. Dismiss completed task from status bar.
8. Confirm no blank pages.
9. Confirm browser console has no new runtime/provider errors.
10. Confirm Filter and Targeted still behave as before.

If live auth is unavailable in preview, document that in the implementation report and perform code-level/build validation.

## Git Commit

After validation:

```bash
git add .
git commit -m "feat(tasks): add global background task status bar"
git push origin feature/autopilot-paper-mode
```

Do not commit temporary helper scripts.

## Claude Completion Report

After implementation, create:

- `docs/reviews/TE-0005B-Implementation-Report.md`

The report must include:

- Executive summary
- Files changed
- UX behavior
- Provider/app shell wiring
- Task state handling
- Open Results behavior
- Dismiss behavior
- Build results
- Manual smoke test results
- Diff statistics
- Technical debt
- Recommendations before TE-0005C
