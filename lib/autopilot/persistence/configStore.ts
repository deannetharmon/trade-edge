// lib/autopilot/persistence/configStore.ts

import type { AutopilotConfig } from '../types';
import { DEFAULT_AUTOPILOT_CONFIG, sanitizeAutopilotConfig } from '../config';
import { autopilotConfigAuditKey, autopilotConfigKey } from './keys';
import { withAutopilotRedis } from './redis';

export interface ConfigAuditEntry {
  timestamp: string;
  oldValue: AutopilotConfig | null;
  newValue: AutopilotConfig;
  reason: string;
}

export async function getAutopilotConfig(userId: string): Promise<AutopilotConfig> {
  return withAutopilotRedis(async (redis) => {
    const raw = await redis.get(autopilotConfigKey(userId));
    if (!raw) {
      const initial = sanitizeAutopilotConfig({ ...DEFAULT_AUTOPILOT_CONFIG });
      await redis.set(autopilotConfigKey(userId), JSON.stringify(initial));
      return initial;
    }
    return sanitizeAutopilotConfig(JSON.parse(raw));
  });
}

export async function saveAutopilotConfig(userId: string, input: unknown, reason = 'user_update'): Promise<AutopilotConfig> {
  return withAutopilotRedis(async (redis) => {
    const key = autopilotConfigKey(userId);
    const oldRaw = await redis.get(key);
    const oldValue = oldRaw ? sanitizeAutopilotConfig(JSON.parse(oldRaw)) : null;
    const newValue = sanitizeAutopilotConfig(input);

    await redis.set(key, JSON.stringify(newValue));

    const auditEntry: ConfigAuditEntry = {
      timestamp: new Date().toISOString(),
      oldValue,
      newValue,
      reason,
    };
    await redis.lpush(autopilotConfigAuditKey(userId), JSON.stringify(auditEntry));
    await redis.ltrim(autopilotConfigAuditKey(userId), 0, 499);

    return newValue;
  });
}

export async function getAutopilotConfigAudit(userId: string, limit = 50): Promise<ConfigAuditEntry[]> {
  return withAutopilotRedis(async (redis) => {
    const rows = await redis.lrange(autopilotConfigAuditKey(userId), 0, Math.max(0, limit - 1));
    return rows.map((row) => JSON.parse(row) as ConfigAuditEntry);
  });
}
