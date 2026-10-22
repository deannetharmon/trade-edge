// lib/portfolio/tickSize.ts

// ORDER-PCT-INPUT-0001 (Ian): a price typed as a percentage is sent at a price the exchange accepts. TastyTrade publishes each
// option root's tick table on its chain (`tick-sizes`, e.g. [{threshold:"3.0",value:"0.01"},{value:"0.05"}]: $0.01 below
// $3.00, $0.05 at or above). Prices are rounded to the nearest valid tick, and the percentage shown is recomputed from the
// rounded price. Without a table (fetch failed) prices fall back to whole cents, today's behaviour; the broker still validates.

export interface TickStep {
  /** Applies to prices strictly below this; null = every price at or above the previous threshold. */
  threshold: number | null;
  value: number;
}

export type TickTable = TickStep[];

const toNumber = (raw: unknown): number | null => {
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : NaN;
  return Number.isFinite(n) ? n : null;
};

/** Parses a chain item's `tick-sizes`; null when absent or malformed (never a guessed table). */
export function parseTickSizes(raw: unknown): TickTable | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const steps: TickTable = [];
  for (const entry of raw) {
    const value = toNumber((entry as { value?: unknown })?.value);
    if (value == null || value <= 0) return null;
    const rawThreshold = (entry as { threshold?: unknown })?.threshold;
    const threshold = rawThreshold == null ? null : toNumber(rawThreshold);
    if (rawThreshold != null && threshold == null) return null;
    steps.push({ threshold, value });
  }
  const bounded = steps.filter(s => s.threshold != null).sort((a, b) => (a.threshold as number) - (b.threshold as number));
  const open = steps.filter(s => s.threshold == null);
  if (open.length !== 1) return null;
  return [...bounded, open[0]];
}

/** Tick that applies to a price. */
export function tickSizeFor(price: number, table: TickTable | null): number {
  if (!table) return 0.01;
  for (const step of table) {
    if (step.threshold == null || price < step.threshold) return step.value;
  }
  return 0.01;
}

const cents = (n: number) => Math.round(n * 100) / 100;

/**
 * Nearest valid price for a typed or computed price. Rounds within the tick band the price falls in; a result that lands
 * across a threshold is re-checked against that band's tick. Never returns less than one tick.
 */
export function roundToTick(price: number, table: TickTable | null): number {
  if (!Number.isFinite(price)) return price;
  const tick = tickSizeFor(price, table);
  let rounded = cents(Math.round(price / tick) * tick);
  const tickAtResult = tickSizeFor(rounded, table);
  if (tickAtResult !== tick) rounded = cents(Math.round(rounded / tickAtResult) * tickAtResult);
  return Math.max(rounded, tickSizeFor(0, table));
}

/** True when a price is already on a valid tick. */
export function isOnTick(price: number, table: TickTable | null): boolean {
  return Number.isFinite(price) && Math.abs(roundToTick(price, table) - price) < 1e-9;
}

/** Smallest on-tick price at or above `price` (ties and float noise resolved in whole cents). TICK-0002: shared with the entry bracket. */
export function ceilToTick(price: number, table: TickTable | null): number {
  const tick = tickSizeFor(price, table);
  const ticks = Math.ceil(cents(price) / tick - 1e-9);
  let result = cents(ticks * tick);
  const tickAtResult = tickSizeFor(result, table);
  if (tickAtResult !== tick) result = cents(Math.ceil(cents(result) / tickAtResult - 1e-9) * tickAtResult);
  return result;
}

/** Largest on-tick price at or below `price`, never below one tick. */
export function floorToTick(price: number, table: TickTable | null): number {
  const tick = tickSizeFor(price, table);
  const ticks = Math.floor(cents(price) / tick + 1e-9);
  const result = cents(ticks * tick);
  return Math.max(result, tickSizeFor(0, table));
}

// TICK-0002 (Ian, Alan, Quinn): the broker is the source of truth for tick size. A chain's published `tick-sizes` can disagree with
// what the broker accepts for an order (NVDL: the chain said $0.01 below $3, the broker demanded $0.05). Two helpers keep the
// rule in one place: the broker's own stated tick becomes a floor under every step of the table, and a rejection message is read
// for that tick. Nothing here guesses: an unreadable message yields null.

/** Ticks the broker is known to use for options; anything else in a message is not trusted as a tick. */
const MAX_BROKER_TICK = 1;

/**
 * The tick the broker named in a rejection ("Price must be in increments of $0.05 for this order"), or null when the message does
 * not name one. Only a positive whole number of cents up to $1.00 is accepted.
 */
export function parseBrokerTick(message: unknown): number | null {
  if (typeof message !== 'string') return null;
  const match = /increments?\s+of\s+\$?\s*(\d*\.?\d+)/i.exec(message);
  if (!match) return null;
  const value = Number(match[1]);
  if (!Number.isFinite(value) || value <= 0 || value > MAX_BROKER_TICK) return null;
  const inCents = Math.round(value * 100);
  if (Math.abs(inCents - value * 100) > 1e-6 || inCents < 1) return null;
  return inCents / 100;
}

/**
 * The tick table with the broker's stated tick as a floor under every step: tick = max(brokerTick, table tick at that price).
 * With no table the broker's tick applies at every price. A missing or invalid broker tick leaves the table as it is.
 */
export function applyBrokerTick(table: TickTable | null, brokerTick: number | null | undefined): TickTable | null {
  if (brokerTick == null || !Number.isFinite(brokerTick) || brokerTick <= 0) return table;
  if (!table) return [{ threshold: null, value: brokerTick }];
  return table.map(step => ({ threshold: step.threshold, value: Math.max(step.value, brokerTick) }));
}

/** An entry credit snapped DOWN to the tick (never asks for more than the trader chose, and is never below one tick). No table: whole cents. */
export function snapEntryCredit(price: number, table: TickTable | null): number {
  if (!Number.isFinite(price)) return price;
  if (!table) return cents(price);
  return floorToTick(price, table);
}

/**
 * One +/- button press. From a price that is on a tick it moves by the larger of `minStep` and the tick at that price; from a price
 * that is off the tick it moves to the nearest valid tick in that direction. It always lands on a valid tick and never goes below
 * one tick. With no table it moves by `minStep` in whole cents (the buttons' behaviour before TICK-0002).
 */
export function stepByTick(price: number, direction: 1 | -1, table: TickTable | null, minStep = 0.05): number {
  if (!Number.isFinite(price)) return price;
  if (!table) return Math.max(cents(price + direction * minStep), 0.01);
  if (!isOnTick(price, table)) return direction > 0 ? ceilToTick(price, table) : floorToTick(price, table);
  const raw = cents(price + direction * Math.max(minStep, tickSizeFor(price, table)));
  return direction > 0 ? ceilToTick(raw, table) : floorToTick(raw, table);
}

/** OCC root (e.g. "SOXL", "AAPL1") from a space-padded OCC symbol. */
export function occRoot(occSymbol: string): string {
  return occSymbol.slice(0, 6).trim();
}

/**
 * The tick table for an option's root from its underlying's nested chain response (`data.items[]`). Matches the item whose
 * `root-symbol` equals the OCC root; a single-item chain is used when no root matches. Null when none is published.
 */
export function tickTableFromNestedChain(chain: unknown, occSymbol: string): TickTable | null {
  const items = (chain as { data?: { items?: unknown[] } })?.data?.items;
  if (!Array.isArray(items) || items.length === 0) return null;
  const root = occRoot(occSymbol);
  const match = items.find(item => (item as { 'root-symbol'?: unknown })?.['root-symbol'] === root)
    ?? (items.length === 1 ? items[0] : undefined);
  return match ? parseTickSizes((match as { 'tick-sizes'?: unknown })['tick-sizes']) : null;
}

/** "sent $3.80 · 29.6%" when the sent price changed the percentage the trader typed; null when it did not. */
export function sentPriceNote(typedPct: number, sentPrice: number, sentPct: number | null): string | null {
  if (sentPct == null || !Number.isFinite(typedPct) || Math.abs(sentPct - typedPct) < 0.05) return null;
  return `sent $${sentPrice.toFixed(2)} · ${sentPct.toFixed(1)}%`;
}

/** Profit kept, in percent of the original credit, for a buy-to-close price (one decimal; null if not computable). */
export function keptPct(creditPerContract: number, price: number): number | null {
  if (!Number.isFinite(creditPerContract) || creditPerContract <= 0 || !Number.isFinite(price) || price <= 0) return null;
  return Math.round((1 - price / creditPerContract) * 1000) / 10;
}

/** Stop trigger, in percent of the original credit (one decimal; null if not computable). */
export function stopPctOfCredit(creditPerContract: number, trigger: number): number | null {
  if (!Number.isFinite(creditPerContract) || creditPerContract <= 0 || !Number.isFinite(trigger) || trigger <= 0) return null;
  return Math.round((trigger / creditPerContract) * 1000) / 10;
}
