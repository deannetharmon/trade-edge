// features/portfolio/positions-workspace/model/stockHoldings.ts
//
// STOCKS-0001 -- the "Stock holdings" section of Position Analysis. Pure: rows, totals, the as-of label, the notes / price-alert key, and the
// alert check, all read from what the workspace model already holds (EquityHolding and the symbol's covered-call CapacityViewModel). Nothing is
// estimated: a basis that is incomplete gives no cost and no P/L, a missing price gives no value, and a partial total says it is partial.
//
// Sign conventions (from normalizeEquity): shares are a positive magnitude with the direction alongside; a short holding's value and P/L are
// negative-signed there, and are shown as they are.

import type { EquityHolding } from '@/lib/portfolio-snapshot/types';
import type { SymbolGroupViewModel } from './types';

export const SHARES_PER_CONTRACT = 100;

export type CoveredTone = 'good' | 'neutral' | 'watch';
export interface CoveredCallCell { kind: 'available' | 'committed' | 'needs-shares' | 'not-applicable' | 'unavailable'; headline: string; detail: string | null; tone: CoveredTone }

export interface StockHoldingRow {
  /** The notes / price-alert key for this holding (its own format, so it cannot collide with an option position's key). */
  key: string;
  accountNumber: string;
  symbol: string;
  direction: 'Long' | 'Short';
  /** Signed for display: negative for a short holding. */
  shares: number;
  sharesNote: string | null;
  price: number | null;
  value: number | null;
  avgCost: number | null;
  /** Average cost x shares (a positive amount, for a long or a short), only when the basis is complete. */
  costBasis: number | null;
  basisComplete: boolean;
  pnl: number | null;
  pnlPct: number | null;
  covered: CoveredCallCell;
  quoteAsOf: string | null;
  stale: boolean;
}

/** `equity:META:long` -- option positions are never keyed this way. */
export function stockNoteKey(symbol: string, direction: 'Long' | 'Short'): string {
  return `equity:${symbol.trim().toUpperCase()}:${direction.toLowerCase()}`;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function coveredCell(holding: EquityHolding, group: Pick<SymbolGroupViewModel, 'capacity'>): CoveredCallCell {
  if (holding.direction === 'Short') return { kind: 'not-applicable', headline: 'Not applicable to short stock', detail: null, tone: 'neutral' };
  const cap = group.capacity;
  if (cap.status === 'unavailable') return { kind: 'unavailable', headline: 'Unavailable', detail: cap.blockingReason, tone: 'watch' };
  const total = Math.floor(cap.sharesOwned / SHARES_PER_CONTRACT);
  if (total < 1) {
    return { kind: 'needs-shares', headline: `Needs ${plural(SHARES_PER_CONTRACT - cap.sharesOwned, 'more share')}`, detail: '0 of 1 contract available', tone: 'neutral' };
  }
  if (cap.availableContracts > 0) {
    const committed = cap.allocatedContracts + cap.reservedContracts;
    return { kind: 'available', headline: `${cap.availableContracts} of ${plural(total, 'contract')} available`, detail: committed > 0 ? `${plural(committed, 'contract')} committed to short calls or pending orders` : null, tone: 'good' };
  }
  const parts = [cap.allocatedContracts > 0 ? `${plural(cap.allocatedContracts, 'contract')} committed to short calls` : null, cap.reservedContracts > 0 ? `${plural(cap.reservedContracts, 'contract')} reserved by pending orders` : null].filter(Boolean);
  return { kind: 'committed', headline: `All ${plural(total, 'contract')} committed`, detail: parts.length > 0 ? parts.join(' · ') : null, tone: 'neutral' };
}

export function buildStockHoldingRows(groups: Array<Pick<SymbolGroupViewModel, 'symbol' | 'equities' | 'capacity'>>): StockHoldingRow[] {
  const rows: StockHoldingRow[] = [];
  for (const group of groups) {
    for (const holding of group.equities) {
      const magnitude = Math.abs(holding.quantity);
      const costBasis = holding.basisComplete && finite(holding.basis) && holding.basis > 0 ? holding.basis * magnitude : null;
      const pnl = finite(holding.unrealizedPnl) ? holding.unrealizedPnl : null;
      rows.push({
        key: stockNoteKey(holding.symbol, holding.direction), accountNumber: holding.accountNumber, symbol: holding.symbol, direction: holding.direction,
        shares: holding.direction === 'Short' ? -magnitude : magnitude, sharesNote: holding.direction === 'Short' ? `Short ${plural(magnitude, 'share')}` : null,
        price: finite(holding.currentPrice) ? holding.currentPrice : null, value: finite(holding.marketValue) ? holding.marketValue : null,
        avgCost: costBasis != null ? holding.basis : null, costBasis, basisComplete: costBasis != null,
        pnl: costBasis != null ? pnl : null, pnlPct: costBasis != null && pnl != null ? (pnl / costBasis) * 100 : null,
        covered: coveredCell(holding, group), quoteAsOf: holding.quoteAsOf, stale: holding.staleQuote,
      });
    }
  }
  return rows.sort((a, b) => a.symbol.localeCompare(b.symbol) || a.direction.localeCompare(b.direction));
}

export interface StockTotals {
  holdings: number;
  hasShort: boolean;
  /** "Net value" when any holding is short, so a total that includes a short is not mistaken for long value. */
  valueLabel: 'Value' | 'Net value';
  value: number | null;
  valueIncluded: number;
  /** Shown only when every holding has a complete basis. */
  costBasis: number | null;
  pnl: number | null;
  /** How many holdings the P/L total covers. */
  pnlIncluded: number;
  /** Shown only when every holding has a P/L and a complete basis; a partial total never gets a percentage. */
  pnlPct: number | null;
  complete: boolean;
}

export function buildStockTotals(rows: StockHoldingRow[]): StockTotals {
  const withValue = rows.filter(r => r.value != null);
  const withPnl = rows.filter(r => r.pnl != null);
  const complete = rows.length > 0 && withPnl.length === rows.length && rows.every(r => r.costBasis != null);
  const cost = complete ? rows.reduce((sum, r) => sum + (r.costBasis as number), 0) : null;
  const pnl = withPnl.length > 0 ? withPnl.reduce((sum, r) => sum + (r.pnl as number), 0) : null;
  const round = (v: number | null) => (v == null ? null : Math.round(v * 100) / 100);
  return {
    holdings: rows.length, hasShort: rows.some(r => r.direction === 'Short'), valueLabel: rows.some(r => r.direction === 'Short') ? 'Net value' : 'Value',
    value: withValue.length > 0 ? round(withValue.reduce((sum, r) => sum + (r.value as number), 0)) : null, valueIncluded: withValue.length,
    costBasis: round(cost), pnl: round(pnl), pnlIncluded: withPnl.length,
    pnlPct: complete && cost != null && cost > 0 && pnl != null ? (pnl / cost) * 100 : null, complete,
  };
}

/** Whether a saved price alert has been reached at the given price (the same rule the option rows use). */
export function isPriceAlertCrossed(alert: { targetPrice: number; direction: 'above' | 'below' } | null | undefined, price: number | null | undefined): boolean {
  if (!alert || !finite(price)) return false;
  return alert.direction === 'above' ? price >= alert.targetPrice : price <= alert.targetPrice;
}

// ---- as-of label --------------------------------------------------------------------------------------------------------------

export interface PricesAsOf { text: string; staleCount: number }

/**
 * "Prices as of 10:45 PM · market closed" -- the OLDEST price time among the holdings (so a stale one is never hidden), with the weekday added
 * when it is not from today ("as of Fri 4:00 PM"). Null when no price time is known.
 */
export function stockPricesAsOf(input: { rows: Array<Pick<StockHoldingRow, 'quoteAsOf' | 'stale'>>; fallback: string | null; nowMs: number; marketOpen: boolean; timeZone?: string }): PricesAsOf | null {
  const times = input.rows.map(r => (r.quoteAsOf ? Date.parse(r.quoteAsOf) : Number.NaN)).filter(Number.isFinite);
  const fallback = input.fallback ? Date.parse(input.fallback) : Number.NaN;
  const oldest = times.length > 0 ? Math.min(...times) : Number.isFinite(fallback) ? fallback : null;
  if (oldest == null) return null;
  const tz = input.timeZone;
  const day = (ms: number) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));
  const clock = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' }).format(new Date(oldest));
  const weekday = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' }).format(new Date(oldest));
  const label = day(oldest) === day(input.nowMs) ? clock : `${weekday} ${clock}`;
  return { text: `Prices as of ${label}${input.marketOpen ? '' : ' · market closed'}`, staleCount: input.rows.filter(r => r.stale).length };
}
