// components/tasks/TaskDrawerItem.tsx
'use client';

import Link from 'next/link';
import type { TradeEdgeTask } from '@/lib/tasks/task-types';
import {
  getTaskOpenHref,
  isActiveStatus,
  statusAccentClass,
  statusBarClass,
  statusLabel,
  truncateMessage,
} from './task-status-utils';

export interface TaskDrawerItemProps {
  task: TradeEdgeTask;
  onDismiss?: (taskId: string) => void;
}

function formatTimestamp(value?: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function terminalTimestamp(task: TradeEdgeTask): string | null {
  return formatTimestamp(task.completedAt ?? task.cancelledAt);
}

export function TaskDrawerItem({ task, onDismiss }: TaskDrawerItemProps) {
  const active = isActiveStatus(task.status);
  const href = getTaskOpenHref(task);
  const progressPct = Math.max(0, Math.min(100, task.progressPct ?? (active ? 8 : 100)));
  const timeLabel = terminalTimestamp(task);

  return (
    <div className="rounded-md border border-[#2c2c2c] bg-[#151515] p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-[12px] font-semibold text-white">{task.title}</div>
          <div className={`mt-0.5 text-[10px] tracking-wide ${statusAccentClass(task.status)}`}>
            {statusLabel(task)}
            {timeLabel ? <span className="text-[#707070]"> · {timeLabel}</span> : null}
          </div>
        </div>

        {!active && onDismiss ? (
          <button
            onClick={() => onDismiss(task.id)}
            className="shrink-0 text-[10px] tracking-wide text-[#808080] transition-colors hover:text-white"
            aria-label={`Dismiss ${task.title}`}
          >
            Dismiss
          </button>
        ) : null}
      </div>

      {active ? (
        <>
          <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-[#2c2c2c]">
            <div
              className={`h-full ${statusBarClass(task.status)} transition-all duration-300`}
              style={{ width: `${progressPct}%` }}
            />
          </div>
          {task.progressLabel ? (
            <div className="mt-1.5 truncate text-[10px] text-[#808080]" title={task.progressLabel}>
              {task.progressLabel}
            </div>
          ) : null}
        </>
      ) : null}

      {task.status === 'failed' && task.error ? (
        <div className="mt-2 text-[10px] text-red-400/80" title={task.error}>
          {truncateMessage(task.error)}
        </div>
      ) : null}

      {href ? (
        <div className="mt-2">
          <Link
            href={href}
            className="inline-flex rounded border border-blue-500/40 px-2 py-1 text-[10px] tracking-wide text-blue-300 transition-colors hover:bg-blue-500/10"
          >
            Open Results
          </Link>
        </div>
      ) : null}
    </div>
  );
}
