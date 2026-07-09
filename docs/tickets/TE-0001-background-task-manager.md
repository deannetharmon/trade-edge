# TE-0001 Background Task Manager

## Status

Proposed

## Owner

Product: Dean Harmon  
Architecture / Review: ChatGPT  
Implementation: Claude

## Priority

High, but implementation comes after current build stabilization.

## Problem

Trade Edge scans can take long enough that the user may navigate away from the current tab or move to another area of the app before the scan completes. Today, scan progress and completion are too tightly coupled to the visible page/component lifecycle.

This creates three product problems:

1. A scan can appear lost or abandoned when the user leaves the current tab.
2. The user does not get a reliable app-level completion signal.
3. Future Autopilot / Paper Mode workflows need a durable task model before they can safely run multi-step background work.

## User story

As a trader using Trade Edge, I want long-running scans and autopilot-style jobs to continue even when I navigate elsewhere in the app, so I can keep working and be notified when the result is ready.

## Scope

TE-0001 is a documentation and architecture ticket. It should define the background task model before implementation.

The later implementation should support:

- App-level task registry for scan/job state.
- Background-safe task execution that is not destroyed by page navigation.
- Task status states: `queued`, `running`, `completed`, `failed`, `cancelled`.
- User-visible completion notification inside the app.
- Ability to reopen/view latest task result from anywhere in the app.
- Initial support for screener/ranked scan tasks.
- Future compatibility with Autopilot Paper Mode tasks.

## Non-goals

Do not implement the runtime background task manager in this ticket.

Do not add browser push notifications yet.

Do not add server-side queues, Redis jobs, cron, or durable cloud workers yet unless a later ADR approves that design.

Do not change trading recommendation logic in this ticket.

## Product requirements

### P0 requirements

1. Scans must continue when the user navigates away from the current in-app tab/page.
2. The app must show a clear task status indicator while a scan is running.
3. The app must notify the user when the scan completes or fails.
4. The user must be able to access the completed scan result from another page.
5. The task model must be reusable for future Autopilot Paper Mode workflows.

### P1 requirements

1. Allow cancelling an active task.
2. Show elapsed runtime and completed timestamp.
3. Store recent task history for the current browser session.
4. Provide a single app-level task panel/toast area.

### P2 requirements

1. Persist task history across browser refreshes.
2. Support browser notifications after explicit user permission.
3. Support server-backed durable tasks.

## Proposed implementation direction

Start with a client-side app-level task manager because the immediate user issue is in-app navigation, not closing the browser.

Recommended first implementation:

- Create a task provider mounted near the root layout/app shell.
- Move long-running scan execution out of page-local component state.
- Represent each background job as a `TradeEdgeTask` object.
- Store active/recent tasks in provider state, optionally mirrored to `sessionStorage`.
- Expose hooks such as `useTaskManager()` and `useTask(taskId)`.
- Add a global task notification component visible across the app.
- Have screener/ranked scan start a task and navigate-independent result state.

## Suggested types

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
  progressLabel?: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  cancelledAt?: string;
}
```

## Acceptance criteria

For this documentation ticket:

- `docs/tickets/` exists.
- `docs/decisions/` exists.
- TE-0001 ticket exists and captures requirements, non-goals, implementation direction, and validation criteria.
- Background Task Manager decision record exists.
- No app runtime behavior changes are made.

For the later implementation ticket:

- Start a ranked/screener scan.
- Navigate to another Trade Edge tab while the scan is running.
- Scan continues without losing state.
- Completion/failure notification appears outside the original page.
- Completed result can be reopened from another page.
- Existing build passes.

## Validation steps

Documentation-only validation:

```bash
git status
find docs -maxdepth 3 -type f | sort
sed -n '1,220p' docs/tickets/TE-0001-background-task-manager.md
sed -n '1,220p' docs/decisions/ADR-0001-background-task-manager.md
npm run build
```

Expected result:

- Docs files are present.
- Ticket content is readable.
- Decision record content is readable.
- Build result is unchanged by docs-only changes.

## Git workflow

```bash
git checkout feature/autopilot-paper-mode
git pull --ff-only
mkdir -p docs/tickets docs/decisions
# add docs files
git add docs/tickets docs/decisions
git commit -m "docs: add background task manager ticket"
git push origin feature/autopilot-paper-mode
```

## Follow-up tickets

- TE-0002 Implement client-side task manager provider.
- TE-0003 Move ranked scan execution into background task manager.
- TE-0004 Add global task status/toast UI.
- TE-0005 Evaluate durable server-backed tasks for Autopilot Paper Mode.
