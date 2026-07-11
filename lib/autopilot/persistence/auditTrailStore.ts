import { auditEventsKey } from './keys';
import { withAutopilotRedis } from './redis';

export type AuditEvent = {
  id: string;
  eventType: 'recommendation_generated' | 'review_opened' | 'submit_pressed' | 'broker_ack' | 'order_accepted' | 'order_rejected';
  positionId?: string;
  orderId?: string;
  payload: Record<string, unknown>;
  createdAt: string;
};

export async function appendAuditEvent(userId: string, event: AuditEvent): Promise<void> {
  return withAutopilotRedis(async (redis) => {
    await redis.lpush(auditEventsKey(userId), JSON.stringify(event));
    await redis.ltrim(auditEventsKey(userId), 0, 4999); // audit trail — keep more history than decision log
  });
}

export async function getAuditEvents(userId: string, limit = 500): Promise<AuditEvent[]> {
  return withAutopilotRedis(async (redis) => {
    const rows = await redis.lrange(auditEventsKey(userId), 0, Math.max(0, limit - 1));
    return rows.map((row) => JSON.parse(row) as AuditEvent);
  });
}
