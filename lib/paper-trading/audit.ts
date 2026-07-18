// lib/paper-trading/audit.ts
//
// PT-0001 section 9.3: append-only audit events for every paper-trading
// mutation and rejection. Mirrors the existing append-only pattern already
// used by lib/autopilot/persistence/auditTrailStore.ts (lpush + ltrim) but
// uses its own key namespace and its own PaperAuditEventType union — that
// existing store's event types (broker_ack, order_accepted, ...) describe
// live-order/broker events and do not apply here. No secrets or auth tokens
// are ever included in a stored event.

import { withAutopilotRedis } from '@/lib/autopilot/persistence/redis';
import { paperAuditKey } from './persistence/keys';
import type { PaperAuditEvent } from './types';

const PAPER_AUDIT_MAX_ENTRIES = 4999;

function createEventId(): string {
  return `paper_audit_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export async function appendPaperAuditEvent(userId: string, event: Omit<PaperAuditEvent, 'id'>): Promise<PaperAuditEvent> {
  const full: PaperAuditEvent = { id: createEventId(), ...event };
  await withAutopilotRedis(async (redis) => {
    await redis.lpush(paperAuditKey(userId), JSON.stringify(full));
    await redis.ltrim(paperAuditKey(userId), 0, PAPER_AUDIT_MAX_ENTRIES);
  });
  return full;
}

export async function getPaperAuditEvents(userId: string, limit = 200): Promise<PaperAuditEvent[]> {
  return withAutopilotRedis(async (redis) => {
    const rows = await redis.lrange(paperAuditKey(userId), 0, Math.max(0, limit - 1));
    return rows.map((row) => JSON.parse(row) as PaperAuditEvent);
  });
}
