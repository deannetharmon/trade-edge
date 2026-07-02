// lib/tasks/task-manager.ts

import { TaskEventBus } from './task-events';
import { TaskStore } from './task-store';
import type {
  CreateTaskInput,
  TradeEdgeTask,
  TradeEdgeTaskEventListener,
  TradeEdgeTaskEventType,
} from './task-types';

/**
 * TaskManager owns execution state for long-running work.
 *
 * It composes an in-memory TaskStore (raw task records) with a
 * TaskEventBus (lifecycle notifications). This is intentionally the
 * Task Manager only — it does not accept commands or intent. Routing
 * "what should happen" is the Command Bus's job (see TE-0002 / ADR-0002)
 * and is explicitly out of scope for this ticket.
 */
export class TaskManager {
  private store: TaskStore;
  private events: TaskEventBus;

  constructor(store: TaskStore = new TaskStore(), events: TaskEventBus = new TaskEventBus()) {
    this.store = store;
    this.events = events;
  }

  createTask<TInput = unknown, TResult = unknown>(
    input: CreateTaskInput<TInput>
  ): TradeEdgeTask<TInput, TResult> {
    const task = this.store.createTask<TInput, TResult>(input);
    this.events.emit({ type: 'task-created', task });
    return task;
  }

  startTask(taskId: string): TradeEdgeTask | undefined {
    const task = this.store.startTask(taskId);
    if (task) this.events.emit({ type: 'task-started', task });
    return task;
  }

  updateTask(taskId: string, patch: Partial<TradeEdgeTask>): TradeEdgeTask | undefined {
    const task = this.store.updateTask(taskId, patch);
    if (task) this.events.emit({ type: 'task-updated', task });
    return task;
  }

  updateProgress(
    taskId: string,
    progressPct?: number,
    progressLabel?: string
  ): TradeEdgeTask | undefined {
    const task = this.store.updateProgress(taskId, progressPct, progressLabel);
    if (task) this.events.emit({ type: 'task-progress', task });
    return task;
  }

  completeTask<TResult = unknown>(taskId: string, result?: TResult): TradeEdgeTask | undefined {
    const task = this.store.completeTask(taskId, result);
    if (task) this.events.emit({ type: 'task-completed', task });
    return task;
  }

  failTask(taskId: string, error: string): TradeEdgeTask | undefined {
    const task = this.store.failTask(taskId, error);
    if (task) this.events.emit({ type: 'task-failed', task });
    return task;
  }

  cancelTask(taskId: string): TradeEdgeTask | undefined {
    const task = this.store.cancelTask(taskId);
    if (task) this.events.emit({ type: 'task-cancelled', task });
    return task;
  }

  removeTask(taskId: string): boolean {
    const task = this.store.getTask(taskId);
    const removed = this.store.removeTask(taskId);
    if (removed && task) this.events.emit({ type: 'task-removed', task });
    return removed;
  }

  getTask(taskId: string): TradeEdgeTask | undefined {
    return this.store.getTask(taskId);
  }

  getAllTasks(): TradeEdgeTask[] {
    return this.store.getAllTasks();
  }

  subscribe(type: TradeEdgeTaskEventType, listener: TradeEdgeTaskEventListener): () => void {
    return this.events.on(type, listener);
  }

  subscribeAll(listener: TradeEdgeTaskEventListener): () => void {
    return this.events.onAny(listener);
  }
}

