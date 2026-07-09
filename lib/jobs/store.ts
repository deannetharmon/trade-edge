import { getRedis } from './redis';
import type { ServerJobRecord, ServerJobStatus, ServerJobType } from './types';

const JOB_TTL_SECONDS = 60 * 60 * 6;

function jobKey(jobId: string) {
  return `trade-edge:job:${jobId}`;
}

function newJobId(): string {
  return `job_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export async function createServerJob<TInput>(args: {
  type: ServerJobType;
  title: string;
  input: TInput;
}): Promise<ServerJobRecord<TInput>> {
  const now = new Date().toISOString();
  const job: ServerJobRecord<TInput> = {
    id: newJobId(),
    type: args.type,
    title: args.title,
    input: args.input,
    status: 'queued',
    progressPct: 0,
    progressLabel: 'Queued',
    createdAt: now,
    updatedAt: now,
  };

  await saveServerJob(job);
  return job;
}

export async function getServerJob<TInput = unknown, TResult = unknown>(jobId: string): Promise<ServerJobRecord<TInput, TResult> | null> {
  const raw = await getRedis().get(jobKey(jobId));
  if (!raw) return null;
  return JSON.parse(raw) as ServerJobRecord<TInput, TResult>;
}

export async function saveServerJob(job: ServerJobRecord): Promise<void> {
  await getRedis().set(jobKey(job.id), JSON.stringify(job), 'EX', JOB_TTL_SECONDS);
}

export async function patchServerJob<TResult = unknown>(
  jobId: string,
  patch: Partial<Omit<ServerJobRecord<unknown, TResult>, 'id' | 'createdAt' | 'input' | 'type'>>
): Promise<ServerJobRecord<unknown, TResult> | null> {
  const job = await getServerJob(jobId);
  if (!job) return null;

  const next: ServerJobRecord<unknown, TResult> = {
    ...job,
    ...patch,
    updatedAt: new Date().toISOString(),
  } as ServerJobRecord<unknown, TResult>;

  await saveServerJob(next);
  return next;
}

export async function markServerJobStatus<TResult = unknown>(
  jobId: string,
  status: ServerJobStatus,
  patch: Partial<ServerJobRecord<unknown, TResult>> = {}
): Promise<ServerJobRecord<unknown, TResult> | null> {
  const now = new Date().toISOString();
  return patchServerJob<TResult>(jobId, {
    ...patch,
    status,
    startedAt: status === 'running' ? now : patch.startedAt,
    completedAt: ['completed', 'failed', 'cancelled'].includes(status) ? now : patch.completedAt,
  });
}
