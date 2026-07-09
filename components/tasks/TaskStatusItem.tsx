// components/tasks/TaskStatusItem.tsx
'use client';

import Link from 'next/link';
import type { TradeEdgeTask } from '@/lib/tasks/task-types';
import {
  isActiveStatus,
  statusAccentClass,
  statusBarClass,
  statusLabel,
  truncateMessage,
  canOpenResult,
} from './task-status-utils';

export interface TaskStatusItemProps {
  task: TradeEdgeTask;
  onDismiss: (taskId: string) => void;
}

/** Where "Open Results" sends the user for a given task kind. Only ranked-scan is wired in TE-0005B. */
function openResultsHref(task: TradeEdgeTask): string | null {
  if (task.kind === 'ranked-scan') return '/screener?mode=rank';
  return null;
}

export function TaskStatusItem({ task, onDismiss }: TaskStatusItemProps) {
  const active = isActiveStatus(task.status);
  const accent = statusAccentClass(task.status);
  const bar = statusBarClass(task.status);
  const href = openResultsHref(task);

  return (
    <div className="px-3 py-2 border-t border-[#2c2c2c] first:border-t-0">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-medium text-white truncate">{task.title}</span>
        <span className={`text-[10px] tracking-wide ${accent}`}>{statusLabel(task)}</span>
      </div>

      {active && (
        <div className="mt-1.5 h-1 w-full rounded-full bg-[#2c2c2c] overflow-hidden">
          <div
            className={`h-full ${bar} transition-all duration-300`}
            style={{ width: `${task.progressPct != null ? Math.max(0, Math.min(100, task.progressPct)) : 8}%` }}
          />
        </div>
      )}

      {active && task.progressLabel && (
        <div className="mt-1 text-[10px] text-[#808080] truncate">{task.progressLabel}</div>
      )}

      {task.status === 'failed' && task.error && (
        <div className="mt-1 text-[10px] text-red-400/80 truncate" title={task.error}>
          {truncateMessage(task.error)}
        </div>
      )}

      {!active && (
        <div className="mt-1.5 flex items-center gap-3">
          {canOpenResult(task) && href && (
            <Link
              href={href}
              className="text-[10px] text-blue-400 hover:text-blue-300 transition-colors tracking-wide"
            >
              Open Results
            </Link>
          )}
          <button
            onClick={() => onDismiss(task.id)}
            className="text-[10px] text-[#808080] hover:text-white transition-colors tracking-wide"
          >
            Dismiss
          </button>
        </div>
      )}
    </div>
  );
}

