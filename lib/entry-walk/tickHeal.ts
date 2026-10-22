// lib/entry-walk/tickHeal.ts
//
// TICK-0002 (Ian, Alan, Quinn): a DRY RUN that the broker rejects with "Price must be in increments of $X" is retried ONCE, at prices
// snapped to the tick the broker named. A dry run places nothing, so a single retry is safe. Rules:
//   - the entry is snapped first (down, never below one tick); the target, stop trigger and stop limit are derived from it
//   - one retry at most, and only when the message named a tick that raised the tick in force; a message that names no tick, or
//     the same tick again, is shown as an error with every price that was sent, and nothing is retried
//   - the tick the broker names is remembered per option root (lib/portfolio/brokerTick.ts) even when the retry also fails
//   - this helper is for dry runs only: a rejected LIVE submit is never resent automatically (see describeLearnedTick)

import { effectiveTickTable, learnFromBrokerMessage } from '@/lib/portfolio/brokerTick';
import { snapEntryCredit, type TickTable } from '@/lib/portfolio/tickSize';

export interface BrokerAttempt {
  ok: boolean;
  /** The broker's error text when not ok; empty when ok. */
  message: string;
  data: unknown;
}

export interface TickHealInput<P> {
  /** Option root of the order's leg (NVDL, AAPL1 ...): the key the learned tick is stored under. */
  root: string;
  /** The tick table the chain published (null when it could not be loaded). */
  chainTable: TickTable | null;
  /** The entry price the trader chose, per share. */
  entry: number;
  /** Builds the whole order for an entry price and the tick table in force. */
  build(entry: number, table: TickTable | null): P;
  /** One broker dry-run call. Network and auth failures should throw; a broker rejection returns ok: false. */
  post(payload: P): Promise<BrokerAttempt>;
}

export interface HealNote {
  /** The tick the broker named. */
  tick: number;
  entryBefore: number;
  entryAfter: number;
}

interface HealBase<P> {
  /** The entry price that was last sent (snapped). */
  entry: number;
  /** The tick table in force for the last attempt. */
  table: TickTable | null;
  payload: P;
  /** Set when a retry at the broker's tick was made. */
  healed: HealNote | null;
}

export type TickHealResult<P> =
  | (HealBase<P> & { ok: true; data: unknown })
  | (HealBase<P> & { ok: false; message: string; /** The first attempt's message, when a retry also failed. */ firstMessage: string | null });

export async function postWithTickHeal<P>(input: TickHealInput<P>): Promise<TickHealResult<P>> {
  const table0 = effectiveTickTable(input.chainTable, input.root);
  const entry0 = snapEntryCredit(input.entry, table0);
  const payload0 = input.build(entry0, table0);
  const first = await input.post(payload0);
  if (first.ok) return { ok: true, data: first.data, entry: entry0, table: table0, payload: payload0, healed: null };

  const learned = learnFromBrokerMessage(input.root, first.message);
  if (!learned || !learned.changed) {
    return { ok: false, message: first.message, firstMessage: null, entry: entry0, table: table0, payload: payload0, healed: null };
  }

  const table1 = effectiveTickTable(input.chainTable, input.root);
  const entry1 = snapEntryCredit(entry0, table1);
  const payload1 = input.build(entry1, table1);
  const healed: HealNote = { tick: learned.tick, entryBefore: entry0, entryAfter: entry1 };
  const second = await input.post(payload1);
  if (second.ok) return { ok: true, data: second.data, entry: entry1, table: table1, payload: payload1, healed };

  // The retry failed too. Remember anything new it names, so the next manual attempt starts right, but never retry again.
  learnFromBrokerMessage(input.root, second.message);
  return { ok: false, message: second.message, firstMessage: first.message, entry: entry1, table: table1, payload: payload1, healed };
}

/**
 * Text for a trader after a rejected LIVE order. A live submit is never resent automatically (it could place two orders), so the
 * learned tick is only remembered and the trader is told to review the price and place again. Null when the message named no tick.
 */
export function describeLearnedTick(root: string, message: unknown): string | null {
  const learned = learnFromBrokerMessage(root, message);
  if (!learned) return null;
  return `The broker's tick for ${root} is $${learned.tick.toFixed(2)}. It is remembered; nothing was resent. Review the price and place the order again.`;
}

/** One line for the dialog after a dry run that needed the broker's tick: what moved and why. Null when nothing was healed. */
export function describeHeal(root: string, healed: HealNote | null): string | null {
  if (!healed) return null;
  const moved = healed.entryAfter !== healed.entryBefore ? ` Entry sent at $${healed.entryAfter.toFixed(2)} (was $${healed.entryBefore.toFixed(2)}).` : '';
  return `The broker's tick for ${root} is $${healed.tick.toFixed(2)}, so prices were adjusted to it.${moved}`;
}
