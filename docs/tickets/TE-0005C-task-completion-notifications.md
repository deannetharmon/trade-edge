# TE-0005C — Task Completion Notifications

**Status:** Ready for Implementation  
**Branch:** `feature/autopilot-paper-mode`

## Objective

Add lightweight in-app completion notifications for background tasks, starting with Ranked Scan.

TE-0005B added the persistent Global Background Task Status Bar. TE-0005C adds transient notifications when a task reaches a terminal state.

This ticket should reuse existing Task Manager state and must not create a separate task system.

## Required Reading

Claude must read these first:

- `docs/architecture/Engineering-Principles.md`
- `docs/architecture/System-Map.md`
- `docs/tickets/TE-0003-implement-task-manager-foundation.md`
- `docs/tickets/TE-0004-implement-command-bus-foundation.md`
- `docs/tickets/TE-0005A-background-ranked-scan-infrastructure.md`
- `docs/tickets/TE-0005B-global-background-task-status-bar.md`
- `docs/reviews/TE-0005A-Implementation-Report.md`
- `docs/reviews/TE-0005B-Implementation-Report.md`
- `docs/reviews/RF-0001-Implementation-Report.md`

Claude should inspect:

- `lib/tasks/`
- `components/tasks/TaskStatusBar.tsx`
- `components/tasks/TaskStatusItem.tsx`
- `components/tasks/task-status-utils.ts`
- `hooks/useTaskManager.ts`
- `app/providers.tsx`
- `app/screener/page.tsx`
- `features/screener/hooks/useRankedScan.ts`

## User Story

As a Trade Edge user, I want to be notified when a background scan finishes, fails, or is cancelled so I know when to return to the result without constantly watching the status bar.

## Scope

Implement in-app task completion notifications.

Start with `ranked-scan` task notifications.

Notifications should appear when a task transitions to:

- `completed`
- `failed`
- `cancelled`

## Non-Goals

Do not:

- Add browser/OS notifications.
- Add notification permissions.
- Add a full Task Center page.
- Add persistent notification history.
- Migrate Screener.
- Change Ranked Scan formulas.
- Change Portfolio AI.
- Change Autopilot.
- Add server-side workers, queues, Redis, or persistence.
- Add live trading behavior.

## Suggested Files

Create:

```text
components/tasks/TaskNotifications.tsx
components/tasks/TaskNotificationToast.tsx
```

Update if needed:

```text
components/tasks/task-status-utils.ts
app/providers.tsx
app/screener/page.tsx
```

The exact file split may vary, but keep notification UI under `components/tasks/`.

## UX Requirements

### Completed Ranked Scan

Show an in-app notification:

```text
Ranked Scan Complete
[Open Results] [Dismiss]
```

If result count is easily available without brittle coupling, include it:

```text
Ranked Scan Complete
512 candidates found
[Open Results] [Dismiss]
```

### Failed Ranked Scan

Show:

```text
Ranked Scan Failed
<short error>
[Dismiss]
```

### Cancelled Ranked Scan

Show:

```text
Ranked Scan Cancelled
[Dismiss]
```

## Behavior Requirements

- Notifications should be app-wide.
- Notifications should not appear for tasks that were already terminal before the notification component mounted, unless that is already the current status-bar behavior and is easy to align.
- Notifications should not spam repeatedly for the same task.
- Dismiss should hide the notification.
- Open Results should route to `/screener` and use existing Ranked Scan reconnect/result behavior.
- Notifications should be visually compact and non-disruptive.
- Status bar should continue to work.
- Task records should not be destroyed just because a notification is dismissed.

## Architecture Requirements

Use the existing Task Manager as the source of truth.

Preferred approach:

- Subscribe to Task Manager task events.
- Track which terminal task IDs have already produced notifications.
- Render a small notification stack/toast region.
- Reuse task display utilities when practical.
- Keep notification-specific dismissal state local to the notification component.

Do not create a second task registry.

Do not duplicate status-bar state logic if a shared utility is appropriate.

## Provider / App Shell Wiring

Mount the notification component once globally.

Preferred location:

- same global app shell/provider area as `TaskStatusBar`

Preserve existing provider order.

Do not reorder `SessionProvider`, `TaskProvider`, or `CommandProvider` unless required and documented.

## Acceptance Criteria

- Completed Ranked Scan creates an in-app notification.
- Failed Ranked Scan creates an in-app notification.
- Cancelled Ranked Scan creates an in-app notification.
- Notification can be dismissed.
- Completed Ranked Scan notification includes Open Results.
- Open Results routes to Screener and preserves existing result recovery behavior.
- Status bar still works.
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
2. Navigate away from Screener.
3. Confirm global status bar remains visible.
4. Wait for completion.
5. Confirm completion notification appears.
6. Click Open Results.
7. Confirm Screener shows completed Ranked Scan results.
8. Dismiss notification.
9. Confirm status bar still behaves correctly.
10. Confirm no blank pages or provider/context errors.

If live auth is unavailable in preview, document that in the implementation report and perform build/code-level validation.

## Git Commit

After validation:

```bash
git add .
git commit -m "feat(tasks): add task completion notifications"
git push origin feature/autopilot-paper-mode
```

Do not commit temporary helper scripts.

## Claude Completion Report

After implementation, create:

- `docs/reviews/TE-0005C-Implementation-Report.md`

The report must include:

- Executive summary
- Files changed
- UX behavior
- Notification state handling
- Task event subscription behavior
- Provider/app shell wiring
- Open Results behavior
- Dismiss behavior
- Build results
- Manual smoke test results
- Diff statistics
- Technical debt
- Recommendations before TE-0005D
