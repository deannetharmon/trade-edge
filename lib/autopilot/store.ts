// lib/autopilot/store.ts

import Redis from 'ioredis';
import { DEFAULT_AUTOPILOT_CONFIG, mergeAutopilotConfig, sanitizeAutopilotConfig } from './config';
import type { AutopilotConfig, AutopilotDecisionLogEntry, PaperAccount } from './types';

function getRedis() {
  const url = process.env.REDIS_URL;
  if (!url) throw new Error('REDIS_URL not configured');
  return new Redis(url);
}

const configKey = (userId: string) => `autopilot:config:${userId}`;
const accountKey = (userId: string) => `autopilot:paper-account:${userId}`;
const logKey = (userId: string) => `autopilot:decision-log:${userId}`;

export function createDefaultPaperAccount(userId: string, startingBalance = 50000): PaperAccount {
  const now = new Date().toISOString();
  return {
    userId,
    startingBalance,
    currentBalance: startingBalance,
    peakBalance: startingBalance,
    openPositions: [],
    closedPositions: [],
    dailyEquityCurve: [{ date: now.slice(0, 10), equity: startingBalance }],
    createdAt: now,
    updatedAt: now,
  };
}

export async function getAutopilotConfig(userId: string): Promise<AutopilotConfig> {
  const redis = getRedis();
  try {
    const raw = await redis.get(configKey(userId));
    if (!raw) {
      const cfg = { ...DEFAULT_AUTOPILOT_CONFIG, updatedAt: new Date().toISOString() };
      await redis.set(configKey(userId), JSON.stringify(cfg));
      return cfg;
    }
    return mergeAutopilotConfig(JSON.parse(raw));
  } finally {
    redis.disconnect();
  }
}

export async function saveAutopilotConfig(userId: string, input: unknown): Promise<AutopilotConfig> {
  const redis = getRedis();
  try {
    const previous = await getAutopilotConfig(userId);
    const next = sanitizeAutopilotConfig(input);
    await redis.set(configKey(userId), JSON.stringify(next));
    await appendAutopilotLog(userId, {
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      action: 'no_action',
      reason: 'Autopilot configuration updated',
      rulesTriggered: ['config_update'],
      rulesBlocked: [],
      configSnapshot: next,
      metadata: { previous, next },
    });
    return next;
  } finally {
    redis.disconnect();
  }
}

export async function getPaperAccount(userId: string): Promise<PaperAccount> {
  const redis = getRedis();
  try {
    const raw = await redis.get(accountKey(userId));
    if (!raw) {
      const acct = createDefaultPaperAccount(userId);
      await redis.set(accountKey(userId), JSON.stringify(acct));
      return acct;
    }
    return JSON.parse(raw) as PaperAccount;
  } finally {
    redis.disconnect();
  }
}

export async function savePaperAccount(account: PaperAccount): Promise<PaperAccount> {
  const redis = getRedis();
  try {
    const updated: PaperAccount = {
      ...account,
      peakBalance: Math.max(account.peakBalance, account.currentBalance),
      updatedAt: new Date().toISOString(),
    };
    await redis.set(accountKey(account.userId), JSON.stringify(updated));
    return updated;
  } finally {
    redis.disconnect();
  }
}

export async function appendAutopilotLog(userId: string, entry: AutopilotDecisionLogEntry): Promise<void> {
  const redis = getRedis();
  try {
    await redis.lpush(logKey(userId), JSON.stringify(entry));
    await redis.ltrim(logKey(userId), 0, 499);
  } finally {
    redis.disconnect();
  }
}

export async function getAutopilotLog(userId: string, limit = 100): Promise<AutopilotDecisionLogEntry[]> {
  const redis = getRedis();
  try {
    const rows = await redis.lrange(logKey(userId), 0, Math.max(0, limit - 1));
    return rows.map((row) => JSON.parse(row) as AutopilotDecisionLogEntry);
  } finally {
    redis.disconnect();
  }
}

export async function resetPaperAccount(userId: string, startingBalance = 50000): Promise<PaperAccount> {
  const account = createDefaultPaperAccount(userId, startingBalance);
  return savePaperAccount(account);
}
