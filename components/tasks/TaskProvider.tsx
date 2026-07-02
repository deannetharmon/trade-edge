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

