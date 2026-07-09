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

function isSettledOrCancelled(taskManager: TaskManager, taskId: string): boolean {
  const status = taskManager.getTask(taskId)?.status;
  return status === 'cancelled' || status === 'completed' || status === 'failed';
}

/**
 * Registers command handlers on the given CommandBus.
 *
 * TE-0005A wires the first real handler: START_RANKED_SCAN. It creates a
 * `ranked-scan` task on the TaskManager, starts it, runs the scan in the
 * background via the Ranked Scan Runner (lib/scans/ranked-scan-runner.ts),
 * and updates/completes/fails/cancels the task as it progresses.
 *
 * Cancellation is intentionally immediate at the task/UI layer: CANCEL_TASK
 * aborts the controller and marks the task cancelled right away. The runner
 * still exits cooperatively, but late progress/completion callbacks are ignored
 * so partial results cannot be promoted after cancellation.
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
          if (isSettledOrCancelled(taskManager, task.id)) return;
          const progressPct = progress.total > 0 ? Math.round((progress.completed / progress.total) * 100) : 0;
          taskManager.updateProgress(task.id, progressPct, progress.label);
        },
        controller.signal
      )
        .then((result) => {
          if (isSettledOrCancelled(taskManager, task.id)) return;
          taskManager.completeTask(task.id, result);
        })
        .catch((err) => {
          if (isSettledOrCancelled(taskManager, task.id)) return;
          if (err instanceof RankedScanCancelledError || controller.signal.aborted) {
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

      const task = taskManager.getTask(taskId);
      if (!task) {
        return { commandId: command.id, handled: true };
      }

      if (task.status === 'queued' || task.status === 'running') {
        rankedScanControllers.get(taskId)?.abort();
        taskManager.cancelTask(taskId);
      }

      return { commandId: command.id, handled: true };
    })
  );

  return () => {
    unsubscribers.forEach((unsubscribe) => unsubscribe());
    rankedScanControllers.forEach((controller, taskId) => {
      controller.abort();
      const task = taskManager.getTask(taskId);
      if (task?.status === 'queued' || task?.status === 'running') {
        taskManager.cancelTask(taskId);
      }
    });
    rankedScanControllers.clear();
  };
}
