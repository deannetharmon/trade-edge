// lib/portfolio/brokerTick.ts
//
// TICK-0002 (Ian, Alan, Quinn): the broker is the source of truth for tick size. A chain's published `tick-sizes` can disagree with
// what the broker accepts for an order (NVDL: the chain said $0.01 below $3, the broker demanded $0.05). When the broker rejects a
// price and names the tick, that tick is remembered here PER OPTION ROOT (NVDL and NVDA never share one) for the rest of the page
// session, and becomes a floor under the chain's table: effective tick = max(broker tick, table tick at that price).
// Nothing is guessed: a message that names no tick teaches nothing.

import { applyBrokerTick, occRoot, parseBrokerTick, type TickTable } from './tickSize';

const learned = new Map<string, number>();

const keyFor = (root: string): string => root.trim().toUpperCase();

/** The option root of an OCC symbol or a bare root, in the form used as the memory key ("NVDL", "AAPL1"). */
export function optionRootOf(occSymbolOrRoot: string): string {
  const text = String(occSymbolOrRoot ?? '');
  return keyFor(text.length > 6 ? occRoot(text) : text);
}

/** The broker tick learned for this option root, or null. */
export function learnedBrokerTick(root: string): number | null {
  return learned.get(keyFor(root)) ?? null;
}

export interface LearnedTick {
  /** The tick now in force for the root. */
  tick: number;
  /** True when this call raised the tick (the table in force is different now). */
  changed: boolean;
}

/** Remembers a tick for the root. The tick only ever rises: a coarser step is always a valid price on a finer one. */
export function learnBrokerTick(root: string, tick: number): LearnedTick | null {
  if (!Number.isFinite(tick) || tick <= 0) return null;
  const key = keyFor(root);
  if (!key) return null;
  const previous = learned.get(key) ?? 0;
  if (tick > previous) {
    learned.set(key, tick);
    return { tick, changed: true };
  }
  return { tick: previous, changed: false };
}

/** Reads a rejection message and remembers the tick it names. Null when the message names none. */
export function learnFromBrokerMessage(root: string, message: unknown): LearnedTick | null {
  const tick = parseBrokerTick(message);
  return tick == null ? null : learnBrokerTick(root, tick);
}

/** The chain's table with this root's learned broker tick as a floor. With nothing learned, the chain's table as it is. */
export function effectiveTickTable(chainTable: TickTable | null, root: string): TickTable | null {
  return applyBrokerTick(chainTable, learnedBrokerTick(root));
}

/** Forgets everything learned. Tests only. */
export function resetLearnedBrokerTicks(): void {
  learned.clear();
}
