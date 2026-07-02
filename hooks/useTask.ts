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

