// components/tasks/TaskNotifications.tsx
'use client';

import { useEffect, useRef, useState } from 'react';
import type { TradeEdgeTask } from '@/lib/tasks/task-types';
import { useTaskManager } from '@/hooks/useTaskManager';
import { isTerminalStatus } from './task-status-utils';
import { TaskNotificationToast } from './TaskNotificationToast';

const MAX_VISIBLE_NOTIFICATIONS = 3;

function shouldNotifyForTask(task: TradeEdgeTask): boolean {
  return task.kind === 'ranked-scan' && isTerminalStatus(task.status);
}

/**
 * Lightweight in-app task completion notifications.
 *
 * This component is intentionally separate from TaskStatusBar:
 * - TaskStatusBar is persistent status visibility.
 * - TaskNotifications is transient terminal-state awareness.
 *
 * It uses TaskManager as the source of truth and keeps dismissal/seen state local.
 */
export function TaskNotifications() {
  const { tasks } = useTaskManager();
  const [notifications, setNotifications] = useState<TradeEdgeTask[]>([]);
  const seenTaskIdsRef = useRef<Set<string>>(new Set());
  const initializedRef = useRef(false);

  useEffect(() => {
    const terminalTasks = tasks.filter(shouldNotifyForTask);

    if (!initializedRef.current) {
      terminalTasks.forEach(task => seenTaskIdsRef.current.add(task.id));
      initializedRef.current = true;
      return;
    }

    const newNotifications = terminalTasks.filter(task => !seenTaskIdsRef.current.has(task.id));

    if (newNotifications.length === 0) return;

    newNotifications.forEach(task => seenTaskIdsRef.current.add(task.id));

    setNotifications(prev => {
      const existingIds = new Set(prev.map(task => task.id));
      const merged = [...newNotifications.filter(task => !existingIds.has(task.id)), ...prev];
      return merged.slice(0, MAX_VISIBLE_NOTIFICATIONS);
    });
  }, [tasks]);

  const handleDismiss = (taskId: string) => {
    setNotifications(prev => prev.filter(task => task.id !== taskId));
  };

  if (notifications.length === 0) return null;

  return (
    <div
      className="fixed top-4 right-4 z-[9999] flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2"
      aria-live="polite"
      aria-label="Task notifications"
    >
      {notifications.map(task => (
        <TaskNotificationToast key={task.id} task={task} onDismiss={handleDismiss} />
      ))}
    </div>
  );
}
