// lib/paper-trading/persistence/store.ts
//
// PT-0001: the only module that reads/writes the canonical account record's
// `paperTrading` field. Wraps the existing lib/autopilot/persistence/
// paperAccountStore.ts get/save functions (same Redis key, same record — see
// lib/paper-trading/types.ts's module doc comment) rather than creating a
// second paper account per user.

import { getPaperAccount, savePaperAccount } from '@/lib/autopilot/persistence/paperAccountStore';
import { createInitialLedger } from '../ledger';
import type { PaperTradingLedger } from '../types';
import { withPaperTradingLock } from './locking';

const DEFAULT_PAPER_TRADING_STARTING_BALANCE = 100000;

/**
 * Returns this user's PT-0001 ledger, lazily initializing (and persisting)
 * a default one on the existing canonical account record if this user has
 * never used PT-0001 before. Never touches any other field on the account.
 */
export async function getPaperTradingLedger(userId: string): Promise<PaperTradingLedger> {
  const account = await getPaperAccount(userId);
  if (account.paperTrading) return account.paperTrading;

  return withPaperTradingLock(userId, async () => {
    // Re-read inside the lock in case another request just initialized it.
    const fresh = await getPaperAccount(userId);
    if (fresh.paperTrading) return fresh.paperTrading;

    const ledger = createInitialLedger(userId, DEFAULT_PAPER_TRADING_STARTING_BALANCE);
    await savePaperAccount({ ...fresh, paperTrading: ledger });
    return ledger;
  });
}

/**
 * Atomically reads the ledger, lets `mutator` compute the next ledger state
 * (plus any extra return value), persists it, and returns the mutator's
 * extra value. All of this happens inside the paper-trading mutation lock,
 * so two concurrent requests for the same user cannot interleave.
 */
export async function mutatePaperTradingLedger<T>(
  userId: string,
  mutator: (current: PaperTradingLedger) => { next: PaperTradingLedger; extra: T } | Promise<{ next: PaperTradingLedger; extra: T }>,
): Promise<T> {
  return withPaperTradingLock(userId, async () => {
    const account = await getPaperAccount(userId);
    const current = account.paperTrading ?? createInitialLedger(userId, DEFAULT_PAPER_TRADING_STARTING_BALANCE);
    const { next, extra } = await mutator(current);
    await savePaperAccount({ ...account, paperTrading: next });
    return extra;
  });
}

/**
 * Like mutatePaperTradingLedger, but for an operation (e.g. a replayed
 * idempotent request) that determines it does not need to change the
 * ledger at all. Still runs inside the same lock as a real mutation so a
 * duplicate-detection decision is never racing a concurrent real mutation.
 */
export async function withPaperTradingLedgerLock<T>(
  userId: string,
  fn: (current: PaperTradingLedger) => Promise<T>,
): Promise<T> {
  return withPaperTradingLock(userId, async () => {
    const account = await getPaperAccount(userId);
    const current = account.paperTrading ?? createInitialLedger(userId, DEFAULT_PAPER_TRADING_STARTING_BALANCE);
    return fn(current);
  });
}

export { DEFAULT_PAPER_TRADING_STARTING_BALANCE };
