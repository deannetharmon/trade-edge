// components/tasks/TaskStatusBar.tsx
'use client';

import { useState } from 'react';
import { useTaskManager } from '@/hooks/useTaskManager';
import { TaskStatusItem } from './TaskStatusItem';
import { isActiveStatus, isTerminalStatus } from './task-status-utils';

/**
 * Persistent global panel showing active and recently-terminal background
 * tasks, mounted once near the app root (see app/providers.tsx). Renders
 * nothing when there are no relevant tasks — adds no visible UI otherwise.
 *
 * Dismissal is local-only (a Set of task IDs in this component's state),
 * per TE-0005B's preferred implementation — it does NOT call
 * TaskManager.removeTask(), so a dismissed-then-later-reopened task (e.g.
 * via Screener's own reconnect logic) is unaffected. Dismissed state does
 * not persist across a full page reload (no localStorage/sessionStorage
 * per ticket's "no persistent storage" non-goal) — this is documented as
 * a known limitation in the implementation report.
 */
export function TaskStatusBar() {
  const { tasks } = useTaskManager();
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());

  const visibleTasks = tasks.filter(t => {
    if (isActiveStatus(t.status)) return true;
    if (isTerminalStatus(t.status) && !dismissedIds.has(t.id)) return true;
    return false;
  });

  if (visibleTasks.length === 0) return null;

  const handleDismiss = (taskId: string) => {
    setDismissedIds(prev => {
      const next = new Set(prev);
      next.add(taskId);
      return next;
    });
  };

  return (
    <div
      className="fixed bottom-4 right-4 z-[9998] w-72 max-w-[calc(100vw-2rem)] rounded-lg border border-[#2c2c2c] bg-[#171717] shadow-xl overflow-hidden"
      role="status"
      aria-live="polite"
    >
      <div className="px-3 py-2 bg-[#0f0f0f] border-b border-[#2c2c2c]">
        <span className="text-[10px] font-medium tracking-widest text-[#aaaaaa]">
          BACKGROUND TASKS{visibleTasks.length > 1 ? ` (${visibleTasks.length})` : ''}
        </span>
      </div>
      <div className="max-h-64 overflow-y-auto">
        {visibleTasks.map(task => (
          <TaskStatusItem key={task.id} task={task} onDismiss={handleDismiss} />
        ))}
      </div>
    </div>
  );
}

