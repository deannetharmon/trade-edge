// lib/autopilot/persistence/decisionLogStore.ts

import type { AutopilotDecisionLogEntry } from '../types';
import { decisionLogKey } from './keys';
import { withAutopilotRedis } from './redis';

export async function appendDecisionLog(userId: string, entry: AutopilotDecisionLogEntry): Promise<void> {
  return withAutopilotRedis(async (redis) => {
    await redis.lpush(decisionLogKey(userId), JSON.stringify(entry));
    await redis.ltrim(decisionLogKey(userId), 0, 999);
  });
}

export async function getDecisionLog(userId: string, limit = 100): Promise<AutopilotDecisionLogEntry[]> {
  return withAutopilotRedis(async (redis) => {
    const rows = await redis.lrange(decisionLogKey(userId), 0, Math.max(0, limit - 1));
    return rows.map((row) => JSON.parse(row) as AutopilotDecisionLogEntry);
  });
}
