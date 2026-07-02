// lib/tasks/task-types.ts

export type TradeEdgeTaskStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type TradeEdgeTaskKind =
  | 'ranked-scan'
  | 'screener-scan'
  | 'portfolio-analysis'
  | 'autopilot-paper-run';

export interface TradeEdgeTask<TInput = unknown, TResult = unknown> {
  id: string;
  kind: TradeEdgeTaskKind;
  title: string;
  status: TradeEdgeTaskStatus;
  input?: TInput;
  result?: TResult;
  error?: string;
  progressPct?: number;
  progressLabel?: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  cancelledAt?: string;
}

export interface CreateTaskInput<TInput = unknown> {
  kind: TradeEdgeTaskKind;
  title: string;
  input?: TInput;
}

export type TradeEdgeTaskEventType =
  | 'task-created'
  | 'task-started'
  | 'task-updated'
  | 'task-progress'
  | 'task-completed'
  | 'task-failed'
  | 'task-cancelled'
  | 'task-removed';

export interface TradeEdgeTaskEvent<TInput = unknown, TResult = unknown> {
  type: TradeEdgeTaskEventType;
  task: TradeEdgeTask<TInput, TResult>;
}

export type TradeEdgeTaskEventListener<TInput = unknown, TResult = unknown> = (
  event: TradeEdgeTaskEvent<TInput, TResult>
) => void;

