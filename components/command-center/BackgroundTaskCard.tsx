// components/command-center/BackgroundTaskCard.tsx
//
// TC-0001: Background Task status card -- reuses the existing global Task
// Manager (TE-0001/0003/0004/0005 series) via useTaskManager(). Displays
// active task name, progress, and completion state; links to the existing
// task drawer/detail surface. Does not create a second task-state store.

import type { THEMES, Theme } from '@/lib/theme';
import type { CommandCenterTasksViewModel } from '@/lib/command-center';

const STATUS_LABEL: Record<string, string> = {
  queued: 'Queued',
  running: 'Running',
  completed: 'Completed',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

export interface BackgroundTaskCardProps {
  backgroundTasks: CommandCenterTasksViewModel;
  th: (typeof THEMES)[Theme];
}

export function BackgroundTaskCard({ backgroundTasks, th }: BackgroundTaskCardProps) {
  return (
    <section className={`mb-6 rounded-xl border ${th.border} ${th.card} p-4`} aria-label="Background Tasks">
      <h2 className={`mb-2 text-[12px] font-bold uppercase tracking-widest ${th.text}`}>Background Tasks</h2>
      {backgroundTasks.state === 'loaded' && backgroundTasks.tasks.length > 0 ? (
        <ul className="space-y-1">
          {backgroundTasks.tasks.map(task => (
            <li key={task.id} className={`flex items-center justify-between rounded-lg border ${th.borderLight} ${th.card} px-3 py-2 text-[11px]`}>
              <span className={th.textMuted}>{task.title}</span>
              <span className="flex items-center gap-2">
                {task.progressPct != null && task.status === 'running' && (
                  <span className={th.textFaint}>{Math.round(task.progressPct)}%</span>
                )}
                <span className={`text-[9px] font-bold uppercase tracking-widest ${th.textFaint}`}>
                  {STATUS_LABEL[task.status] ?? task.status}
                </span>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className={`text-[11px] ${th.textFaint}`}>{backgroundTasks.message ?? 'No background tasks are running.'}</p>
      )}
    </section>
  );
}
