#!/usr/bin/env bash
set -euo pipefail

git pull --ff-only

mkdir -p lib/tasks components/tasks hooks

cat > lib/tasks/task-types.ts << 'EOF'
// lib/tasks/task-types.ts

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
  progressPct?: number;
  progressLabel?: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  cancelledAt?: string;
}

export interface CreateTaskInput<TInput = unknown> {
  kind: TradeEdgeTaskKind;
  title: string;
  input?: TInput;
}

export type TradeEdgeTaskEventType =
  | 'task-created'
  | 'task-started'
  | 'task-updated'
  | 'task-progress'
  | 'task-completed'
  | 'task-failed'
  | 'task-cancelled'
  | 'task-removed';

export interface TradeEdgeTaskEvent<TInput = unknown, TResult = unknown> {
  type: TradeEdgeTaskEventType;
  task: TradeEdgeTask<TInput, TResult>;
}

export type TradeEdgeTaskEventListener<TInput = unknown, TResult = unknown> = (
  event: TradeEdgeTaskEvent<TInput, TResult>
) => void;

EOF

cat > lib/tasks/task-events.ts << 'EOF'
// lib/tasks/task-events.ts

import type {
  TradeEdgeTaskEvent,
  TradeEdgeTaskEventListener,
  TradeEdgeTaskEventType,
} from './task-types';

/**
 * Lightweight, dependency-free publish/subscribe bus for task lifecycle events.
 * No external event-emitter libraries are used.
 */
export class TaskEventBus {
  private listeners: Map<TradeEdgeTaskEventType, Set<TradeEdgeTaskEventListener>> = new Map();
  private wildcardListeners: Set<TradeEdgeTaskEventListener> = new Set();

  /**
   * Subscribe to a specific event type. Returns an unsubscribe function.
   */
  on(type: TradeEdgeTaskEventType, listener: TradeEdgeTaskEventListener): () => void {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set());
    }
    this.listeners.get(type)!.add(listener);
    return () => {
      this.listeners.get(type)?.delete(listener);
    };
  }

  /**
   * Subscribe to all task events regardless of type. Returns an unsubscribe function.
   */
  onAny(listener: TradeEdgeTaskEventListener): () => void {
    this.wildcardListeners.add(listener);
    return () => {
      this.wildcardListeners.delete(listener);
    };
  }

  /**
   * Emit an event to all matching listeners.
   */
  emit(event: TradeEdgeTaskEvent): void {
    this.listeners.get(event.type)?.forEach((listener) => listener(event));
    this.wildcardListeners.forEach((listener) => listener(event));
  }

  /**
   * Remove all listeners. Primarily useful for test teardown.
   */
  clear(): void {
    this.listeners.clear();
    this.wildcardListeners.clear();
  }
}

EOF

cat > lib/tasks/task-store.ts << 'EOF'
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

EOF

cat > lib/tasks/task-manager.ts << 'EOF'
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

EOF

cat > components/tasks/TaskProvider.tsx << 'EOF'
// components/tasks/TaskProvider.tsx
'use client';

import React, { createContext, useContext, useMemo, useRef } from 'react';
import { TaskManager } from '@/lib/tasks/task-manager';

const TaskManagerContext = createContext<TaskManager | null>(null);

/**
 * Mounts a single TaskManager instance for the lifetime of the app shell.
 * Renders no visible UI. Does not alter existing app behavior.
 *
 * Task Center / toast UI and Command Bus wiring are explicitly out of
 * scope for TE-0003 and are deferred to follow-up tickets.
 */
export function TaskProvider({ children }: { children: React.ReactNode }) {
  const managerRef = useRef<TaskManager | null>(null);
  if (!managerRef.current) {
    managerRef.current = new TaskManager();
  }

  const manager = useMemo(() => managerRef.current as TaskManager, []);

  return <TaskManagerContext.Provider value={manager}>{children}</TaskManagerContext.Provider>;
}

export function useTaskManagerContext(): TaskManager {
  const manager = useContext(TaskManagerContext);
  if (!manager) {
    throw new Error('useTaskManagerContext must be used within a TaskProvider');
  }
  return manager;
}

EOF

cat > hooks/useTaskManager.ts << 'EOF'
// hooks/useTaskManager.ts
'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTaskManagerContext } from '@/components/tasks/TaskProvider';
import type { CreateTaskInput, TradeEdgeTask } from '@/lib/tasks/task-types';

export interface UseTaskManagerResult {
  tasks: TradeEdgeTask[];
  createTask: <TInput = unknown, TResult = unknown>(
    input: CreateTaskInput<TInput>
  ) => TradeEdgeTask<TInput, TResult>;
  startTask: (taskId: string) => TradeEdgeTask | undefined;
  updateTask: (taskId: string, patch: Partial<TradeEdgeTask>) => TradeEdgeTask | undefined;
  updateProgress: (
    taskId: string,
    progressPct?: number,
    progressLabel?: string
  ) => TradeEdgeTask | undefined;
  completeTask: <TResult = unknown>(taskId: string, result?: TResult) => TradeEdgeTask | undefined;
  failTask: (taskId: string, error: string) => TradeEdgeTask | undefined;
  cancelTask: (taskId: string) => TradeEdgeTask | undefined;
  removeTask: (taskId: string) => boolean;
  getTask: (taskId: string) => TradeEdgeTask | undefined;
}

/**
 * Provides access to the app-level TaskManager: current tasks plus
 * lifecycle actions. Re-renders when any task event fires.
 */
export function useTaskManager(): UseTaskManagerResult {
  const manager = useTaskManagerContext();
  const [tasks, setTasks] = useState<TradeEdgeTask[]>(() => manager.getAllTasks());

  useEffect(() => {
    const unsubscribe = manager.subscribeAll(() => {
      setTasks(manager.getAllTasks());
    });
    return unsubscribe;
  }, [manager]);

  const createTask = useCallback(
    <TInput = unknown, TResult = unknown>(input: CreateTaskInput<TInput>) =>
      manager.createTask<TInput, TResult>(input),
    [manager]
  );

  const startTask = useCallback((taskId: string) => manager.startTask(taskId), [manager]);

  const updateTask = useCallback(
    (taskId: string, patch: Partial<TradeEdgeTask>) => manager.updateTask(taskId, patch),
    [manager]
  );

  const updateProgress = useCallback(
    (taskId: string, progressPct?: number, progressLabel?: string) =>
      manager.updateProgress(taskId, progressPct, progressLabel),
    [manager]
  );

  const completeTask = useCallback(
    <TResult = unknown>(taskId: string, result?: TResult) =>
      manager.completeTask<TResult>(taskId, result),
    [manager]
  );

  const failTask = useCallback(
    (taskId: string, error: string) => manager.failTask(taskId, error),
    [manager]
  );

  const cancelTask = useCallback((taskId: string) => manager.cancelTask(taskId), [manager]);

  const removeTask = useCallback((taskId: string) => manager.removeTask(taskId), [manager]);

  const getTask = useCallback((taskId: string) => manager.getTask(taskId), [manager]);

  return {
    tasks,
    createTask,
    startTask,
    updateTask,
    updateProgress,
    completeTask,
    failTask,
    cancelTask,
    removeTask,
    getTask,
  };
}

EOF

cat > hooks/useTask.ts << 'EOF'
// hooks/useTask.ts
'use client';

import { useEffect, useState } from 'react';
import { useTaskManagerContext } from '@/components/tasks/TaskProvider';
import type { TradeEdgeTask } from '@/lib/tasks/task-types';

/**
 * Subscribes to a single task's live state by id.
 * Returns undefined if the task does not exist (e.g. not yet created,
 * or already removed).
 */
export function useTask(taskId: string | undefined | null): TradeEdgeTask | undefined {
  const manager = useTaskManagerContext();
  const [task, setTask] = useState<TradeEdgeTask | undefined>(() =>
    taskId ? manager.getTask(taskId) : undefined
  );

  useEffect(() => {
    if (!taskId) {
      setTask(undefined);
      return;
    }

    setTask(manager.getTask(taskId));

    const unsubscribe = manager.subscribeAll((event) => {
      if (event.task.id === taskId) {
        setTask(event.task);
      }
    });

    return unsubscribe;
  }, [manager, taskId]);

  return task;
}

EOF

cat > app/providers.tsx << 'EOF'
// app/providers.tsx
'use client';

import { SessionProvider } from 'next-auth/react';
import { TaskProvider } from '@/components/tasks/TaskProvider';

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <TaskProvider>{children}</TaskProvider>
    </SessionProvider>
  );
}

EOF

git add lib/tasks components/tasks hooks app/providers.tsx
git commit -m "fix(tasks): emit task-updated event from updateTask; wrap existing providers"
git push origin feature/autopilot-paper-mode

echo "Done."
