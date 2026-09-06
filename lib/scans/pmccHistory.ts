import type { PmccLifecycleAlert, PmccLifecycleStatus } from './pmccLifecycle';

export const PMCC_HISTORY_RETENTION_DAYS = 548;

export type PmccHistoryEvent = {
  id: string;
  kind: 'LIFECYCLE_ALERT';
  positionKey: string;
  symbol: string;
  observedAt: string;
  status: PmccLifecycleStatus;
  alerts: PmccLifecycleAlert[];
  expiresAt: string;
};

export function lifecycleFingerprint(input: Pick<PmccHistoryEvent, 'positionKey' | 'status' | 'alerts'>): string {
  return JSON.stringify({
    positionKey: input.positionKey,
    status: input.status,
    alerts: input.alerts.map(alert => ({ id: alert.id, severity: alert.severity, message: alert.message })),
  });
}

/** A refresh must not make another history row unless the status/reasons changed.
 * A daily observation is retained even when the current state is unchanged. */
export function shouldAppendLifecycleEvent(last: PmccHistoryEvent | undefined, next: Pick<PmccHistoryEvent, 'positionKey' | 'status' | 'alerts' | 'observedAt'>): boolean {
  if (!last) return true;
  if (last.observedAt.slice(0, 10) !== next.observedAt.slice(0, 10)) return true;
  return lifecycleFingerprint(last) !== lifecycleFingerprint(next);
}
