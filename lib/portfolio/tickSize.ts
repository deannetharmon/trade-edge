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
