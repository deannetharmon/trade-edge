// lib/autopilot/persistence/paperAccountStore.ts

import type { PaperAccount } from '../types';
import { paperAccountKey } from './keys';
import { withAutopilotRedis } from './redis';

const DEFAULT_STARTING_BALANCE = 100000;

export function createInitialPaperAccount(userId: string, startingBalance = DEFAULT_STARTING_BALANCE): PaperAccount {
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

export async function getPaperAccount(userId: string): Promise<PaperAccount> {
  return withAutopilotRedis(async (redis) => {
    const key = paperAccountKey(userId);
    const raw = await redis.get(key);
    if (raw) return JSON.parse(raw) as PaperAccount;

    const account = createInitialPaperAccount(userId);
    await redis.set(key, JSON.stringify(account));
    return account;
  });
}

export async function savePaperAccount(account: PaperAccount): Promise<PaperAccount> {
  const next: PaperAccount = {
    ...account,
    peakBalance: Math.max(account.peakBalance, account.currentBalance),
    updatedAt: new Date().toISOString(),
  };

  return withAutopilotRedis(async (redis) => {
    await redis.set(paperAccountKey(next.userId), JSON.stringify(next));
    return next;
  });
}

export async function resetPaperAccount(userId: string, startingBalance = DEFAULT_STARTING_BALANCE): Promise<PaperAccount> {
  const account = createInitialPaperAccount(userId, startingBalance);
  return savePaperAccount(account);
}
