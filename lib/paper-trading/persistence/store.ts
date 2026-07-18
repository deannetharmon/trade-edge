// lib/paper-trading/persistence/store.ts
//
// PT-0001: the only module (besides persistence/commit.ts, which performs
// the atomic accepted-mutation write) that reads the canonical account
// record's `paperTrading` field. Wraps the existing
// lib/autopilot/persistence/paperAccountStore.ts get/save functions (same
// Redis key, same record — see lib/paper-trading/types.ts's module doc
// comment) rather than creating a second paper account per user.
//
// PT-0001 corrective round (fix #3): mutatePaperTradingLedger() and
// withPaperTradingLedgerLock() have been removed. They persisted the ledger
// via a single savePaperAccount() call that happened AFTER the mutator
// callback had already written the accepted audit event and idempotency
// record separately — three non-atomic writes, the exact defect the
// corrective round requires fixed. service.ts now performs every accepted
// open/close/reset through persistence/commit.ts's commitPaperMutation(),
// which commits the ledger, the one accepted audit event, and the
// idempotency record together in a single Redis transaction. The read-only
// lazy-initialization path below (getPaperTradingLedger) has no
// audit/idempotency component and is unaffected by that defect, so it is
// unchanged apart from threading the lock id through withPaperTradingLock's
// updated signature.

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

export { DEFAULT_PAPER_TRADING_STARTING_BALANCE };
