// lib/commands/command-handlers.ts

import type { CommandBus } from './command-bus';
import type { TaskManager } from '@/lib/tasks/task-manager';
import {
  runRankedScan,
  RankedScanCancelledError,
} from '@/lib/scans/ranked-scan-runner';
import type {
  RankedScanInput,
  RankedScanResult,
} from '@/lib/scans/ranked-scan-runner';

export interface StartRankedScanResult {
  taskId: string;
}

export interface CancelTaskPayload {
  taskId: string;
}

/**
 * Registers command handlers on the given CommandBus.
 *
 * TE-0005A wires the first real handler: START_RANKED_SCAN. It creates a
 * `ranked-scan` task on the TaskManager, starts it, runs the scan in the
 * background via the Ranked Scan Runner (lib/scans/ranked-scan-runner.ts),
 * and updates/completes/fails/cancels the task as it progresses. A
 * CANCEL_TASK handler is also registered so a running ranked-scan task can
 * be aborted cooperatively per ADR-0003 — no cancel UI is added in this
 * ticket (that's Task Center scope), but the capability is wired and
 * dispatchable.
 *
 * All other command types (START_SCREENER_SCAN, RUN_PORTFOLIO_AI_REVIEW,
 * START_AUTOPILOT_PAPER_RUN, OPEN_TASK_RESULT) remain unregistered —
 * deferred to their own tickets. Until a handler is registered for a
 * command type, CommandBus.dispatch() safely returns `{ handled: false }`
 * rather than throwing.
 */
export function registerCommandHandlers(bus: CommandBus, taskManager: TaskManager): () => void {
  const unsubscribers: Array<() => void> = [];

  // Tracks the AbortController for each in-flight ranked-scan task so
  // CANCEL_TASK can signal it. Cleaned up when the task settles.
  const rankedScanControllers = new Map<string, AbortController>();

  unsubscribers.push(
    bus.registerHandler<RankedScanInput, StartRankedScanResult>('START_RANKED_SCAN', async (command) => {
      const input = command.payload;
      if (!input) {
        return { commandId: command.id, handled: true, error: 'START_RANKED_SCAN requires a payload' };
      }

      const task = taskManager.createTask<RankedScanInput, RankedScanResult>({
        kind: 'ranked-scan',
        title: 'Ranked Scan',
        input,
      });
      taskManager.startTask(task.id);

      const controller = new AbortController();
      rankedScanControllers.set(task.id, controller);

      // Fire-and-forget: the task itself (not this handler's return value)
      // is how the caller observes progress/completion. Command dispatch
      // resolves immediately with the taskId so the page can reconnect.
      runRankedScan(
        input,
        (progress) => {
          const progressPct = progress.total > 0 ? Math.round((progress.completed / progress.total) * 100) : 0;
          taskManager.updateProgress(task.id, progressPct, progress.label);
        },
        controller.signal
      )
        .then((result) => {
          taskManager.completeTask(task.id, result);
        })
        .catch((err) => {
          if (err instanceof RankedScanCancelledError) {
            taskManager.cancelTask(task.id);
          } else {
            taskManager.failTask(task.id, err instanceof Error ? err.message : 'Ranked scan failed');
          }
        })
        .finally(() => {
          rankedScanControllers.delete(task.id);
        });

      return { commandId: command.id, handled: true, result: { taskId: task.id } };
    })
  );

  unsubscribers.push(
    bus.registerHandler<CancelTaskPayload, void>('CANCEL_TASK', async (command) => {
      const taskId = command.payload?.taskId;
      if (!taskId) {
        return { commandId: command.id, handled: true, error: 'CANCEL_TASK requires a taskId' };
      }
      const controller = rankedScanControllers.get(taskId);
      if (controller) {
        controller.abort();
      }
      // If no controller is found (task already settled, or not a
      // cancellable kind), this is a safe no-op — the task's own status
      // is left as-is rather than force-cancelled here.
      return { commandId: command.id, handled: true };
    })
  );

  return () => {
    unsubscribers.forEach((unsubscribe) => unsubscribe());
    rankedScanControllers.forEach((controller) => controller.abort());
    rankedScanControllers.clear();
  };
}

