// lib/tasks/task-store.ts

import type { CreateTaskInput, TradeEdgeTask, TradeEdgeTaskStatus } from './task-types';

function generateTaskId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `task-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * In-memory task registry. Owns raw task records only.
 * Does not emit events or perform side effects — that responsibility
 * belongs to TaskManager, which composes this store with TaskEventBus.
 */
export class TaskStore {
  private tasks: Map<string, TradeEdgeTask> = new Map();

  createTask<TInput = unknown, TResult = unknown>(
    input: CreateTaskInput<TInput>
  ): TradeEdgeTask<TInput, TResult> {
    const task: TradeEdgeTask<TInput, TResult> = {
      id: generateTaskId(),
      kind: input.kind,
      title: input.title,
      status: 'queued',
      input: input.input,
      createdAt: new Date().toISOString(),
    };
    this.tasks.set(task.id, task as TradeEdgeTask);
    return task;
  }

  startTask(taskId: string): TradeEdgeTask | undefined {
    return this.setStatus(taskId, 'running', { startedAt: new Date().toISOString() });
  }

  updateTask(taskId: string, patch: Partial<TradeEdgeTask>): TradeEdgeTask | undefined {
    const existing = this.tasks.get(taskId);
    if (!existing) return undefined;
    const updated: TradeEdgeTask = { ...existing, ...patch, id: existing.id };
    this.tasks.set(taskId, updated);
    return updated;
  }

  updateProgress(
    taskId: string,
    progressPct?: number,
    progressLabel?: string
  ): TradeEdgeTask | undefined {
    return this.updateTask(taskId, { progressPct, progressLabel });
  }

  completeTask<TResult = unknown>(taskId: string, result?: TResult): TradeEdgeTask | undefined {
    return this.setStatus(taskId, 'completed', {
      result,
      completedAt: new Date().toISOString(),
    });
  }

  failTask(taskId: string, error: string): TradeEdgeTask | undefined {
    return this.setStatus(taskId, 'failed', {
      error,
      completedAt: new Date().toISOString(),
    });
  }

  cancelTask(taskId: string): TradeEdgeTask | undefined {
    return this.setStatus(taskId, 'cancelled', {
      cancelledAt: new Date().toISOString(),
    });
  }

  removeTask(taskId: string): boolean {
    return this.tasks.delete(taskId);
  }

  getTask(taskId: string): TradeEdgeTask | undefined {
    return this.tasks.get(taskId);
  }

  getAllTasks(): TradeEdgeTask[] {
    return Array.from(this.tasks.values());
  }

  private setStatus(
    taskId: string,
    status: TradeEdgeTaskStatus,
    patch: Partial<TradeEdgeTask>
  ): TradeEdgeTask | undefined {
    return this.updateTask(taskId, { ...patch, status });
  }
}

