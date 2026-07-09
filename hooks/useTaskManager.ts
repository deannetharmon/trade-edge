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

