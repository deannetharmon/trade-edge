export type ServerJobType = 'ranked-scan';
export type ServerJobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface ServerJobRecord<TInput = unknown, TResult = unknown> {
  id: string;
  type: ServerJobType;
  status: ServerJobStatus;
  title: string;
  input: TInput;
  result?: TResult;
  error?: string;
  progressPct: number;
  progressLabel: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  updatedAt: string;
}

export interface StartServerJobResponse {
  jobId: string;
}
