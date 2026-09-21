// lib/leaps-position-intelligence/entryCapture.ts
//
// LEAPS-ENTRY-0001 -- server-side, BEST-EFFORT capture of an entry record. It is called only after the broker has already accepted an
// order, and by contract it can never throw, never wait longer than a short timeout, and never influence the order's result: any
// failure (missing Redis, a Redis error, a timeout, an unexpected order shape) is logged without details and swallowed.

import { randomUUID } from 'crypto';
import { getRedis } from '@/lib/jobs/redis';
import { buildEntryRecord, type EntryLegSource, type EntryRecordKind } from './entryRecords';
import { saveEntryRecord, type EntryRedis } from './entryRecordsStore';

export const ENTRY_CAPTURE_TIMEOUT_MS = 2000;

export interface RecordEntryInput {
  kind: EntryRecordKind;
  userId: string;
  /** The broker-confirmed account (used only inside a hashed key; it is not stored in the record). */
  accountNumber: string;
  underlyingSymbol: string;
  longOccSymbol: string;
  shortOccSymbol: string | null;
  quantity: number;
  limitPrice: number;
  priceEffect: 'Debit' | 'Credit';
  long: EntryLegSource | null;
  short: EntryLegSource | null;
  /** The broker's order response (`data`). */
  order: unknown;
}

export type RecordEntryOutcome = 'saved' | 'duplicate' | 'failed' | 'timeout';

export async function recordEntryBestEffort(
  input: RecordEntryInput,
  options: { redis?: EntryRedis; timeoutMs?: number; now?: () => Date } = {},
): Promise<RecordEntryOutcome> {
  const timeoutMs = options.timeoutMs ?? ENTRY_CAPTURE_TIMEOUT_MS;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const work = (async (): Promise<RecordEntryOutcome> => {
      const redis = options.redis ?? (getRedis() as unknown as EntryRedis);
      const record = buildEntryRecord({
        id: randomUUID(), kind: input.kind, recordedAt: (options.now ?? (() => new Date()))().toISOString(),
        underlyingSymbol: input.underlyingSymbol, longOccSymbol: input.longOccSymbol, shortOccSymbol: input.shortOccSymbol,
        quantity: input.quantity, limitPrice: input.limitPrice, priceEffect: input.priceEffect, long: input.long, short: input.short, order: input.order,
      });
      return saveEntryRecord(redis, { userId: input.userId, accountNumber: input.accountNumber }, record);
    })();
    const timeout = new Promise<RecordEntryOutcome>(resolve => { timer = setTimeout(() => resolve('timeout'), timeoutMs); });
    // If the timeout wins, the work may still finish later; its rejection must not become an unhandled one.
    work.catch(() => undefined);
    const outcome = await Promise.race([work, timeout]);
    if (outcome === 'timeout') console.error('LEAPS entry record: timed out (the order was not affected)');
    return outcome;
  } catch {
    console.error('LEAPS entry record: could not be saved (the order was not affected)');
    return 'failed';
  } finally {
    if (timer) clearTimeout(timer);
  }
}
