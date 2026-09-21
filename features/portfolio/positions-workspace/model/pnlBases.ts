// features/portfolio/positions-workspace/model/pnlBases.ts
//
// PNL-BASIS-0001 -- makes the P/L basis explicit on the Position Analysis view. Two P/L figures exist for a position and both are legitimate:
//   * MID       -- valued at the midpoint of the quotes. This is the valuation the Portfolio view shows and the one that reconciles with the broker.
//   * CLOSE-NOW -- valued at the price you would actually get closing right now (marketable buyback / liquidation). This is the execution figure.
// The analysis view already shows close-now for credit spreads (Take Profit uses it) and the midpoint for long options; this module adds the
// other figure next to each, flags a wide market, and reconciles the analysis totals with the Portfolio view. Display only: it never feeds a
// rule, a recommendation, or an order, and it does not change the rules' own inputs (closeNowPnl / pnl).

import type { Position } from '@/lib/portfolio-data/types';
import type { EquityHolding } from '@/lib/portfolio-snapshot/types';
import { signedMoney } from '@/lib/leaps-position-intelligence/incomeCard';
import { money } from '@/lib/leaps-analysis/dashboard';

/** Close-now is called out when it is worse than the mid by more than this % of the position's mid value. */
export const WIDE_MARKET_PCT = 5;

type BasisInput = Pick<Position, 'pnl' | 'closeNowPnl' | 'closeValue' | 'currentValue' | 'entryPriceEffect' | 'entryCredit' | 'entryEconomicsComplete' | 'targetPrice'>;

export interface PositionPnlBases {
  kind: 'credit' | 'debit' | 'unknown';
  /** Midpoint P/L (the Portfolio view's figure). */
  mid: number | null;
  /** P/L if closed at the marketable price right now. For a long option this is derived for display (liquidation proceeds less what was paid). */
  closeNow: number | null;
  /** True when closeNow was derived here rather than taken from the position's own closeNowPnl. */
  closeNowDerived: boolean;
  /** The figure the analysis view shows as primary: closeNowPnl when the position has one, otherwise the midpoint (unchanged behavior). */
  primary: 'close-now' | 'mid';
  /** The opening credit or debit, dollars. */
  entryAmount: number | null;
  /** Profit target in dollars (credit positions with complete entry economics only). */
  targetProfit: number | null;
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export function buildPositionPnlBases(p: BasisInput): PositionPnlBases {
  const kind = p.entryPriceEffect === 'Credit' ? 'credit' : p.entryPriceEffect === 'Debit' ? 'debit' : 'unknown';
  const mid = finite(p.pnl) ? p.pnl : null;
  const complete = p.entryEconomicsComplete !== false;
  const entryAmount = finite(p.entryCredit) && complete ? p.entryCredit : null;
  const ownCloseNow = finite(p.closeNowPnl) ? p.closeNowPnl : null;
  const derived = ownCloseNow == null && kind === 'debit' && entryAmount != null && finite(p.closeValue) ? Math.abs(p.closeValue) - entryAmount : null;
  const targetProfit = kind === 'credit' && p.entryEconomicsComplete === true && finite(p.targetPrice) && p.targetPrice > 0 ? p.targetPrice : null;
  return { kind, mid, closeNow: ownCloseNow ?? derived, closeNowDerived: ownCloseNow == null && derived != null, primary: ownCloseNow != null ? 'close-now' : 'mid', entryAmount, targetProfit };
}

const pctOf = (value: number, base: number | null): number | null => (base != null && base !== 0 ? (value / Math.abs(base)) * 100 : null);

export interface PnlSecondLine { label: string; text: string }

/**
 * The line shown under the primary P/L: the other basis. For a credit position (primary = close-now) it is the midpoint with its % of target;
 * for a long option (primary = mid) it is the derived close-now. Null when there is nothing different to show.
 */
export function buildPnlSecondLine(b: PositionPnlBases): PnlSecondLine | null {
  if (b.primary === 'close-now') {
    if (b.mid == null) return null;
    const ofTarget = b.targetProfit != null ? pctOf(b.mid, b.targetProfit) : null;
    return { label: 'Mid', text: `Mid ${signedMoney(round(b.mid))}${ofTarget != null ? ` · ${ofTarget.toFixed(0)}% of target` : ''}` };
  }
  if (b.closeNow == null) return null;
  if (b.mid != null && Math.abs(b.closeNow - b.mid) < 0.5) return null;
  const ofCost = b.kind === 'debit' ? pctOf(b.closeNow, b.entryAmount) : null;
  return { label: 'Close now', text: `Close now ${signedMoney(round(b.closeNow))}${ofCost != null ? ` (${ofCost.toFixed(1)}%)` : ''}` };
}

/** An amber note when closing now is worse than the mid by more than WIDE_MARKET_PCT of the position's mid value. */
export function wideMarketNote(b: PositionPnlBases, midValue: number | null | undefined): string | null {
  if (b.mid == null || b.closeNow == null || !finite(midValue) || midValue === 0) return null;
  const gap = b.mid - b.closeNow; // positive: closing now is worse than the mid
  if (gap <= 0 || (gap / Math.abs(midValue)) * 100 <= WIDE_MARKET_PCT) return null;
  const dollars = money(Math.round(gap));
  return b.kind === 'debit' ? `Wide market: selling now brings ${dollars} less than the mid.` : `Wide market: closing now costs ${dollars} more than the mid.`;
}

const round = (v: number) => Math.round(v * 100) / 100;

// ---- reconciling the analysis table with the Portfolio view ----------------------------------------------------------------

export interface PnlReconciliation {
  optionCount: number;
  optionsMid: number | null;
  optionsMidMissing: number;
  /** Every option at close-now (derived for long options); null when any option has no close-now figure. */
  optionsCloseNow: number | null;
  optionsCloseNowMissing: number;
  equityCount: number;
  equitiesPnl: number | null;
  equitiesUnpriced: number;
  /** Options at mid plus equities: what the Portfolio view's P/L column adds up to. Null when any part is missing. */
  totalMid: number | null;
  /** The Portfolio view's own total (sum of each symbol's P/L), when every symbol has one. */
  portfolioTotal: number | null;
  /** True/false when both totals exist and are compared (within $1); null when they cannot be compared. */
  reconciles: boolean | null;
}

export function buildPnlReconciliation(input: { options: BasisInput[]; equities: Array<Pick<EquityHolding, 'unrealizedPnl'>>; portfolioTotal: number | null }): PnlReconciliation {
  const bases = input.options.map(buildPositionPnlBases);
  const mids = bases.map(b => b.mid).filter(finite);
  const closeNows = bases.map(b => b.closeNow).filter(finite);
  const equityPnls = input.equities.map(e => e.unrealizedPnl).filter(finite);
  const optionsMid = input.options.length > 0 && mids.length === input.options.length ? round(mids.reduce((a, b) => a + b, 0)) : null;
  const equitiesPnl = input.equities.length > 0 && equityPnls.length === input.equities.length ? round(equityPnls.reduce((a, b) => a + b, 0)) : input.equities.length === 0 ? 0 : null;
  const totalMid = input.options.length === 0 && input.equities.length === 0 ? null
    : optionsMid != null && equitiesPnl != null ? round(optionsMid + equitiesPnl)
    : input.options.length === 0 && equitiesPnl != null ? equitiesPnl : null;
  const portfolioTotal = finite(input.portfolioTotal) ? round(input.portfolioTotal) : null;
  return {
    optionCount: input.options.length,
    optionsMid, optionsMidMissing: input.options.length - mids.length,
    optionsCloseNow: input.options.length > 0 && closeNows.length === input.options.length ? round(closeNows.reduce((a, b) => a + b, 0)) : null,
    optionsCloseNowMissing: input.options.length - closeNows.length,
    equityCount: input.equities.length, equitiesPnl, equitiesUnpriced: input.equities.length - equityPnls.length,
    totalMid, portfolioTotal,
    reconciles: totalMid != null && portfolioTotal != null ? Math.abs(totalMid - portfolioTotal) < 1 : null,
  };
}

export interface ReconciliationText { line: string; tone: 'ok' | 'warn' }

export function describePnlReconciliation(r: PnlReconciliation): ReconciliationText {
  const parts: string[] = [];
  if (r.optionCount > 0) {
    const mid = r.optionsMid != null ? signedMoney(r.optionsMid) : `n/a (${r.optionsMidMissing} unpriced)`;
    const now = r.optionsCloseNow != null ? signedMoney(r.optionsCloseNow) : `n/a for ${r.optionsCloseNowMissing}`;
    parts.push(`Options in this table: mid ${mid} · close-now ${now}`);
  }
  if (r.equityCount > 0) {
    parts.push(`Stock holdings below: ${r.equitiesPnl != null ? signedMoney(r.equitiesPnl) : `partial (${r.equitiesUnpriced} unpriced)`}`);
  }
  if (r.totalMid != null) {
    parts.push(`All positions at mid: ${signedMoney(r.totalMid)}${r.reconciles === true ? ' · matches the Portfolio view' : ''}`);
  }
  let warn = false;
  if (r.reconciles === false && r.totalMid != null && r.portfolioTotal != null) {
    warn = true;
    parts.push(`The Portfolio view's total is ${signedMoney(r.portfolioTotal)}: the two differ by ${money(Math.round(Math.abs(r.totalMid - r.portfolioTotal)))}`);
  }
  return { line: parts.join('  ·  '), tone: warn ? 'warn' : 'ok' };
}
