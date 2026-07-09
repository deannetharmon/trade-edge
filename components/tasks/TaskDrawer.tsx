// components/tasks/TaskDrawer.tsx
'use client';

import { useMemo, useState } from 'react';
import type { TradeEdgeTask } from '@/lib/tasks/task-types';
import { useTaskManager } from '@/hooks/useTaskManager';
import { isActiveStatus, isTerminalStatus } from './task-status-utils';
import { TaskDrawerItem } from './TaskDrawerItem';

function newestFirst(a: TradeEdgeTask, b: TradeEdgeTask): number {
  const aTime = a.completedAt ?? a.cancelledAt ?? a.startedAt ?? a.createdAt;
  const bTime = b.completedAt ?? b.cancelledAt ?? b.startedAt ?? b.createdAt;
  return new Date(bTime).getTime() - new Date(aTime).getTime();
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return <div className="rounded-md border border-dashed border-[#2c2c2c] px-3 py-4 text-center text-[11px] text-[#707070]">{children}</div>;
}

function Section({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-[10px] font-semibold uppercase tracking-widest text-[#aaaaaa]">{title}</h3>
        <span className="text-[10px] text-[#707070]">{count}</span>
      </div>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

/**
 * Compact global task drawer for current-session background task review.
 *
 * This intentionally stays smaller than an Operations Center: no tabs,
 * no persistence, no search/filtering, no retry engine.
 */
export function TaskDrawer() {
  const { tasks } = useTaskManager();
  const [open, setOpen] = useState(false);
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());

  const { activeTasks, recentTasks, problemTasks } = useMemo(() => {
    const visible = tasks.filter(task => !dismissedIds.has(task.id));

    return {
      activeTasks: visible.filter(task => isActiveStatus(task.status)).sort(newestFirst),
      recentTasks: visible
        .filter(task => task.status === 'completed')
        .sort(newestFirst)
        .slice(0, 12),
      problemTasks: visible
        .filter(task => task.status === 'failed' || task.status === 'cancelled')
        .sort(newestFirst)
        .slice(0, 12),
    };
  }, [tasks, dismissedIds]);

  const totalVisible = activeTasks.length + recentTasks.length + problemTasks.length;
  const activeCount = activeTasks.length;

  const dismissTask = (taskId: string) => {
    setDismissedIds(prev => {
      const next = new Set(prev);
      next.add(taskId);
      return next;
    });
  };

  const clearTerminal = () => {
    const terminalIds = tasks.filter(task => isTerminalStatus(task.status)).map(task => task.id);
    setDismissedIds(prev => {
      const next = new Set(prev);
      terminalIds.forEach(id => next.add(id));
      return next;
    });
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-4 left-4 z-[9997] rounded-lg border border-[#2c2c2c] bg-[#171717] px-3 py-2 text-[11px] font-medium tracking-wide text-[#dddddd] shadow-xl transition-colors hover:bg-[#202020]"
        aria-label="Open background task drawer"
      >
        Tasks{activeCount > 0 ? ` (${activeCount})` : ''}
      </button>

      {open ? (
        <div className="fixed inset-0 z-[10000]" aria-modal="true" role="dialog">
          <button
            className="absolute inset-0 cursor-default bg-black/40"
            aria-label="Close task drawer overlay"
            onClick={() => setOpen(false)}
            type="button"
          />

          <aside className="absolute right-0 top-0 flex h-full w-96 max-w-[100vw] flex-col border-l border-[#2c2c2c] bg-[#111111] shadow-2xl">
            <div className="border-b border-[#2c2c2c] px-4 py-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold text-white">Background Tasks</h2>
                  <div className="mt-0.5 text-[10px] text-[#808080]">
                    {totalVisible === 0 ? 'No visible tasks' : `${totalVisible} visible task${totalVisible === 1 ? '' : 's'}`}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="rounded border border-[#2c2c2c] px-2 py-1 text-[11px] text-[#aaaaaa] transition-colors hover:text-white"
                >
                  Close
                </button>
              </div>

              {recentTasks.length + problemTasks.length > 0 ? (
                <button
                  type="button"
                  onClick={clearTerminal}
                  className="mt-3 text-[10px] tracking-wide text-[#808080] transition-colors hover:text-white"
                >
                  Clear Recent
                </button>
              ) : null}
            </div>

            <div className="flex-1 space-y-5 overflow-y-auto px-4 py-4">
              <Section title="Running" count={activeTasks.length}>
                {activeTasks.length > 0 ? (
                  activeTasks.map(task => <TaskDrawerItem key={task.id} task={task} />)
                ) : (
                  <EmptyState>No running background tasks.</EmptyState>
                )}
              </Section>

              <Section title="Recent" count={recentTasks.length}>
                {recentTasks.length > 0 ? (
                  recentTasks.map(task => (
                    <TaskDrawerItem key={task.id} task={task} onDismiss={dismissTask} />
                  ))
                ) : (
                  <EmptyState>No completed tasks in this session.</EmptyState>
                )}
              </Section>

              <Section title="Failed / Cancelled" count={problemTasks.length}>
                {problemTasks.length > 0 ? (
                  problemTasks.map(task => (
                    <TaskDrawerItem key={task.id} task={task} onDismiss={dismissTask} />
                  ))
                ) : (
                  <EmptyState>No failed or cancelled tasks.</EmptyState>
                )}
              </Section>
            </div>
          </aside>
        </div>
      ) : null}
    </>
  );
}
