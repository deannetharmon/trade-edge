// components/tasks/TaskNotificationToast.tsx
'use client';

import Link from 'next/link';
import type { TradeEdgeTask } from '@/lib/tasks/task-types';
import { canOpenResult, statusAccentClass, statusLabel, truncateMessage } from './task-status-utils';

export interface TaskNotificationToastProps {
  task: TradeEdgeTask;
  onDismiss: (taskId: string) => void;
}

function openResultsHref(task: TradeEdgeTask): string | null {
  if (task.kind === 'ranked-scan') return '/screener?mode=rank';
  return null;
}

function resultCountLabel(task: TradeEdgeTask): string | null {
  const result = task.result as unknown;

  if (Array.isArray(result)) return `${result.length} candidates found`;

  if (result && typeof result === 'object') {
    const maybeRecord = result as Record<string, unknown>;
    const candidates = maybeRecord.candidates;
    const results = maybeRecord.results;
    const entries = maybeRecord.entries;

    if (Array.isArray(candidates)) return `${candidates.length} candidates found`;
    if (Array.isArray(results)) return `${results.length} candidates found`;
    if (Array.isArray(entries)) return `${entries.length} candidates found`;
  }

  return null;
}

function titleForTask(task: TradeEdgeTask): string {
  if (task.status === 'completed') return `${task.title} Complete`;
  if (task.status === 'failed') return `${task.title} Failed`;
  if (task.status === 'cancelled') return `${task.title} Cancelled`;
  return `${task.title} ${statusLabel(task)}`;
}

export function TaskNotificationToast({ task, onDismiss }: TaskNotificationToastProps) {
  const href = openResultsHref(task);
  const countLabel = resultCountLabel(task);
  const accent = statusAccentClass(task.status);

  return (
    <div
      className="w-80 max-w-[calc(100vw-2rem)] rounded-lg border border-[#2c2c2c] bg-[#171717] shadow-2xl overflow-hidden"
      role="status"
      aria-live="polite"
    >
      <div className="px-3 py-2 bg-[#0f0f0f] border-b border-[#2c2c2c] flex items-center justify-between gap-3">
        <span className={`text-[11px] font-semibold tracking-wide ${accent}`}>{titleForTask(task)}</span>
        <button
          onClick={() => onDismiss(task.id)}
          className="text-[10px] text-[#808080] hover:text-white transition-colors tracking-wide"
          aria-label={`Dismiss ${task.title} notification`}
        >
          Dismiss
        </button>
      </div>

      <div className="px-3 py-2">
        {task.status === 'completed' && countLabel && (
          <div className="text-[11px] text-[#aaaaaa]">{countLabel}</div>
        )}

        {task.status === 'failed' && task.error && (
          <div className="text-[11px] text-red-400/80" title={task.error}>
            {truncateMessage(task.error)}
          </div>
        )}

        {task.status === 'cancelled' && (
          <div className="text-[11px] text-[#aaaaaa]">Task was cancelled.</div>
        )}

        {canOpenResult(task) && href && (
          <div className="mt-2">
            <Link
              href={href}
              className="inline-flex items-center rounded border border-blue-500/40 px-2 py-1 text-[10px] tracking-wide text-blue-300 hover:bg-blue-500/10 transition-colors"
            >
              Open Results
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
