// components/tasks/task-status-utils.ts
//
// Pure helpers for the global Background Task Status Bar (TE-0005B).
// No React, no side effects — easy to reason about and test in isolation,
// per Engineering Principles #1 (business logic outside components).

import type { TradeEdgeTask, TradeEdgeTaskStatus } from '@/lib/tasks/task-types';

export function isTerminalStatus(status: TradeEdgeTaskStatus): boolean {
  return status === 'completed' || status === 'failed' || status === 'cancelled';
}

export function isActiveStatus(status: TradeEdgeTaskStatus): boolean {
  return status === 'queued' || status === 'running';
}

/** Semantic color classes, reusing the same status-color vocabulary already used across Trade Edge (emerald/blue/red/slate). */
export function statusAccentClass(status: TradeEdgeTaskStatus): string {
  switch (status) {
    case 'running':
    case 'queued':
      return 'text-blue-400';
    case 'completed':
      return 'text-emerald-400';
    case 'failed':
      return 'text-red-400';
    case 'cancelled':
      return 'text-slate-400';
    default:
      return 'text-slate-400';
  }
}

export function statusBarClass(status: TradeEdgeTaskStatus): string {
  switch (status) {
    case 'running':
    case 'queued':
      return 'bg-blue-500';
    case 'completed':
      return 'bg-emerald-500';
    case 'failed':
      return 'bg-red-500';
    case 'cancelled':
      return 'bg-slate-500';
    default:
      return 'bg-slate-500';
  }
}

export function statusLabel(task: TradeEdgeTask): string {
  switch (task.status) {
    case 'queued':
      return 'Queued';
    case 'running':
      return task.progressPct != null ? `Running ${task.progressPct}%` : 'Running';
    case 'completed':
      return 'Complete';
    case 'failed':
      return 'Failed';
    case 'cancelled':
      return 'Cancelled';
    default:
      return '';
  }
}

/** Keeps the status bar compact — long runner/handler error messages get cut. */
export function truncateMessage(message: string | undefined, maxLength = 80): string {
  if (!message) return '';
  return message.length > maxLength ? `${message.slice(0, maxLength - 1)}…` : message;
}

/** TE-0005B only supports Open Results for completed ranked-scan tasks with a result. */
export function canOpenResult(task: TradeEdgeTask): boolean {
  return task.kind === 'ranked-scan' && task.status === 'completed' && task.result != null;
}

