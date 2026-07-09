# TE-0005D — Global Task Drawer

**Status:** Ready for Implementation  
**Branch:** `feature/autopilot-paper-mode`

## Objective

Add a small global Task Drawer that gives the user a fuller view of background tasks without turning this into a large Operations Center.

This is the final task-UX infrastructure ticket before shifting back to trader-facing features.

## Required Reading

Claude must read these first:

- `docs/architecture/Engineering-Principles.md`
- `docs/architecture/System-Map.md`
- `docs/tickets/TE-0003-implement-task-manager-foundation.md`
- `docs/tickets/TE-0005A-background-ranked-scan-infrastructure.md`
- `docs/tickets/TE-0005B-global-background-task-status-bar.md`
- `docs/tickets/TE-0005C-task-completion-notifications.md`
- `docs/reviews/TE-0005A-Implementation-Report.md`
- `docs/reviews/TE-0005B-Implementation-Report.md`
- `docs/reviews/TE-0005C-Implementation-Report.md`

Claude should inspect:

- `components/tasks/TaskStatusBar.tsx`
- `components/tasks/TaskStatusItem.tsx`
- `components/tasks/TaskNotifications.tsx`
- `components/tasks/TaskNotificationToast.tsx`
- `components/tasks/task-status-utils.ts`
- `hooks/useTaskManager.ts`
- `app/providers.tsx`
- `app/screener/page.tsx`

## User Story

As a Trade Edge user, I want to open a compact task drawer from anywhere in the app so I can review running and recent background tasks without leaving my current workflow.

## Scope

Build a small global Task Drawer.

It should:

- be globally mounted
- be accessible from the existing global task status area or a small fixed button
- open as a right-side drawer or compact modal
- show current running/queued tasks
- show recent completed tasks
- show failed/cancelled tasks
- support Open Results for completed Ranked Scan tasks
- support dismiss/clear of terminal tasks from the drawer view
- reuse existing Task Manager state
- reuse existing task status utilities when practical

## Non-Goals

Do not:

- Build a large Operations Center.
- Add tabs.
- Add search/filtering.
- Add persistent task history.
- Add browser/OS notifications.
- Add server-side queues/workers.
- Add retry logic.
- Add task scheduling.
- Migrate Screener.
- Change Ranked Scan formulas.
- Change Portfolio AI.
- Change Autopilot.
- Add live trading behavior.

## Suggested Files

Create if useful:

```text
components/tasks/TaskDrawer.tsx
components/tasks/TaskDrawerButton.tsx
components/tasks/TaskDrawerItem.tsx
```

Update if needed:

```text
components/tasks/TaskStatusBar.tsx
components/tasks/task-status-utils.ts
app/providers.tsx
```

Keep this small. Target implementation should be a compact extension of the existing task UX, not a new subsystem.

## UX Requirements

### Entry Point

Provide a visible way to open the drawer from anywhere.

Preferred options:

1. Add a small "View All" / "Tasks" action to the existing `TaskStatusBar`.
2. Add a small fixed "Tasks" button near the existing status bar area.

Do not add a major navigation redesign.

### Drawer Layout

Minimum sections:

```text
Background Tasks

Running
- Ranked Scan 72%
- Screener queued

Recent
- Ranked Scan Complete    Open Results
- Portfolio AI Complete   View Report (future-disabled or omitted)

Failed / Cancelled
- Screener Failed         Details (future-disabled or omitted)
- Ranked Scan Cancelled
```

Only implement actions that actually work today.

### Running Tasks

Show:

- task title
- status
- progress percent if available
- progress label if available
- compact progress bar

### Recent Terminal Tasks

Show:

- task title
- status
- completed/failed/cancelled state
- Open Results for completed Ranked Scan with result
- Dismiss from drawer view

### Clear Completed

Add a simple "Clear Completed" or "Clear Recent" action if it can be implemented as local drawer state only.

Do not remove TaskManager records unless already safe and intentional.

## Architecture Requirements

Use TaskManager as source of truth.

Do not create a second task registry.

Preferred approach:

- derive task groups from `useTaskManager().tasks`
- keep dismissed/cleared IDs in local component state
- reuse utility functions from `task-status-utils.ts`
- keep Open Results logic consistent with TaskStatusBar/TaskNotifications

If multiple components now need `getTaskOpenHref(task)`, extract that helper into `task-status-utils.ts`.

## Acceptance Criteria

- User can open a global Task Drawer from anywhere.
- Drawer shows running/queued tasks.
- Drawer shows recent completed tasks.
- Drawer shows failed/cancelled tasks.
- Completed Ranked Scan can be opened from drawer.
- Terminal tasks can be dismissed/cleared from drawer view.
- TaskStatusBar still works.
- TaskNotifications still work.
- Existing Ranked Scan behavior remains intact.
- Existing Filter/Targeted behavior remains intact.
- Vercel build passes after push.
- No temporary scripts are committed.

## Validation

Use Vercel as the authoritative build validation after push.

Manual smoke test when authenticated environment is available:

1. Start Ranked Scan.
2. Confirm TaskStatusBar appears.
3. Open Task Drawer.
4. Confirm running task appears.
5. Navigate away from Screener.
6. Confirm drawer remains available.
7. Wait for completion.
8. Confirm completed task appears in Recent.
9. Click Open Results.
10. Confirm Screener shows completed Ranked Scan results.
11. Dismiss/clear completed task from drawer.
12. Confirm TaskStatusBar and TaskNotifications still behave correctly.

If preview authentication is unavailable, document that in the implementation report and rely on Vercel build plus code-level validation.

## Git Commit

After implementation:

```bash
git add .
git commit -m "feat(tasks): add global task drawer"
git push origin feature/autopilot-paper-mode
```

Do not commit temporary helper scripts.

## Claude/Gemini Completion Report

After implementation, create:

- `docs/reviews/TE-0005D-Implementation-Report.md`

The report must include:

- Executive summary
- Files changed
- UX behavior
- Drawer state handling
- Task grouping logic
- Open Results behavior
- Dismiss/clear behavior
- Provider/app shell wiring
- Vercel build result
- Manual smoke test status
- Diff statistics
- Technical debt
- Recommendations before TE-0006
