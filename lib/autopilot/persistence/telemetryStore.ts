// lib/autopilot/persistence/telemetryStore.ts

import { withAutopilotRedis } from './redis';

export interface AutopilotTelemetryEvent {
  id: string;
  timestamp: string;
  userId: string;
  eventType: 'dry_run' | 'cron_probe' | 'manual_probe' | 'framework_error';
  status: 'ok' | 'blocked' | 'error';
  message: string;
  metadata?: Record<string, unknown>;
}

function telemetryKey(userId: string): string {
  return `autopilot:telemetry:${userId}`;
}

export function createTelemetryEvent(args: Omit<AutopilotTelemetryEvent, 'id' | 'timestamp'>): AutopilotTelemetryEvent {
  return {
    ...args,
    id: `tel_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`,
    timestamp: new Date().toISOString(),
  };
}

export async function appendTelemetryEvent(event: AutopilotTelemetryEvent): Promise<void> {
  return withAutopilotRedis(async (redis) => {
    await redis.lpush(telemetryKey(event.userId), JSON.stringify(event));
    await redis.ltrim(telemetryKey(event.userId), 0, 499);
  });
}

export async function getTelemetryEvents(userId: string, limit = 50): Promise<AutopilotTelemetryEvent[]> {
  return withAutopilotRedis(async (redis) => {
    const rows = await redis.lrange(telemetryKey(userId), 0, Math.max(0, limit - 1));
    return rows.map((row) => JSON.parse(row) as AutopilotTelemetryEvent);
  });
}
