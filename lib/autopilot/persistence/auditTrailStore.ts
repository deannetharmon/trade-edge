// lib/autopilot/persistence/auditTrailStore.ts

import { auditEventsKey } from './keys';
import { withAutopilotRedis } from './redis';

export type AuditEventType =
  | 'recommendation_generated'
  | 'review_opened'
  | 'submit_pressed'
  | 'broker_ack'
  | 'order_accepted'
  | 'order_rejected';

export interface AuditEvent {
  id: string;
  eventType: AuditEventType;
  positionId?: string;
  orderId?: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

// Audit trail keeps more history than the decision log (5000 vs 1000 entries)
// since it's the trade-execution record of truth, not a rolling recommendation feed.
const AUDIT_TRAIL_MAX_ENTRIES = 4999;

export async function appendAuditEvent(userId: string, event: AuditEvent): Promise<void> {
  return withAutopilotRedis(async (redis) => {
    await redis.lpush(auditEventsKey(userId), JSON.stringify(event));
    await redis.ltrim(auditEventsKey(userId), 0, AUDIT_TRAIL_MAX_ENTRIES);
  });
}

export async function getAuditEvents(userId: string, limit = 500): Promise<AuditEvent[]> {
  return withAutopilotRedis(async (redis) => {
    const rows = await redis.lrange(auditEventsKey(userId), 0, Math.max(0, limit - 1));
    return rows.map((row) => JSON.parse(row) as AuditEvent);
  });
}
