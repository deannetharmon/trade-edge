// lib/scans/ccGuidance.ts
//
// CC-PMCC-GUIDANCE-0001 slice A -- the covered-call numbers and wording a trader decides from. Pure: no React, no broker.
// One function each for POP, the bid/ask price gap, the fill label, the premium at fill, the yield, the minimum-pay test
// and "Small & safe", so the headline, the three facts, the grid cells and the Review order button can never disagree.
//
// Rules (Ian, Alan, Dean 2026-11-16):
//   POP = (1 - |delta|) x 100. A model estimate from the broker's delta (which reflects IV), not a guarantee.
//   Price gap = (ask - bid) / mid. Fails the hybrid rule at max($0.01, 10% of mid) for covered calls or over $0.50 (see hybridSpread.ts).
//   Fill label: Good (gap under 5%), OK (5 to 10%, expect a few cents less), Price gap too big (fails the rule; never a pick).
//   A call is a pick only when it is not wide and pays at least Dean's minimum (his chip, never below CC_HARD_MIN_PAY).
//   "Small & safe" is offered only when no call is a pick: the highest-paying call that is not wide, sits at or above the
//   cost basis (the grid never holds a strike below it) and has POP of CC_SMALL_SAFE_MIN_POP or more.

import type { CcGrid, CcGridCell } from './ccGridTypes';
import { ccCellNumbers, ccStockMovePct, CC_GOALS, type CcGoal } from './ccGridView';
import { ccRsiChip, type CcRsiChipState } from './ccRsiChip';
import { DEFAULT_CC_RULES } from './constants';
import { CC_GAP_FLOOR_DOLLARS } from './covered-call-finder';

/** POP at or above this is "safe" for a Small & safe call (Dean, 2026-11-16: 90%). */
export const CC_SMALL_SAFE_MIN_POP = 90;
/** The lowest total, for the whole order, the headline will ever recommend, even when the minimum chip says Any. */
export const CC_HARD_MIN_PAY = 10;

export function ccEffectiveMinPay(chip: number): number {
  return Math.max(Number.isFinite(chip) ? chip : 0, CC_HARD_MIN_PAY);
}

/** How the minimum reads in a sentence: Dean's own number, or the app's floor when his chip is Any or lower. */
export function ccMinPayPhrase(chip: number): string {
  return Number.isFinite(chip) && chip >= CC_HARD_MIN_PAY ? `your $${chip} minimum` : `the $${CC_HARD_MIN_PAY} floor`;
}

// ── POP ──────────────────────────────────────────────────────────────────────

export function ccPopPct(delta: number): number {
  const d = Math.min(1, Math.max(0, Math.abs(delta)));
  return Math.round((1 - d) * 100);
}

export type CcPopTone = 'green' | 'yellow' | 'red';

/** 65% or more green, 55 to 64% yellow, under 55% red. Always shown with the number. */
export function ccPopTone(pop: number): CcPopTone {
  return pop >= 65 ? 'green' : pop >= 55 ? 'yellow' : 'red';
}

// ── Price gap and fill ───────────────────────────────────────────────────────

/** (ask - bid) / mid as a percent to one decimal; null for a one-sided, crossed or missing quote. */
export function ccPriceGapPct(bid: number, ask: number): number | null {
  if (!Number.isFinite(bid) || !Number.isFinite(ask) || !(bid > 0) || !(ask > 0) || ask < bid) return null;
  return Math.round(((ask - bid) / ((ask + bid) / 2)) * 1000) / 10;
}

export type CcFillLabel = 'good' | 'ok' | 'too_big';

export const CC_FILL_TEXT: Record<CcFillLabel, string> = { good: 'Good', ok: 'OK', too_big: 'Price gap too big' };

export function ccFillLabel(cell: Pick<CcGridCell, 'bid' | 'ask' | 'wide'>): { label: CcFillLabel; gapPct: number | null } {
  const gapPct = ccPriceGapPct(cell.bid, cell.ask);
  if (cell.wide) return { label: 'too_big', gapPct };
  return { label: gapPct !== null && gapPct < 5 ? 'good' : 'ok', gapPct };
}

/** The low and high end of what the order should collect: the bid up to the premium at fill (the mid rounded down). */
export function ccExpectedFill(grid: CcGrid, cell: CcGridCell): { low: number; high: number } {
  const high = ccCellNumbers(grid, cell).premiumTotal;
  const bidTotal = Math.round(cell.bid * 100 * grid.contracts * 100) / 100;
  return { low: Math.min(bidTotal, high), high };
}

/** What the middle price would pay for the whole order (shown only to say it is not real on a wide spread). */
export function ccMidTotal(grid: CcGrid, cell: Pick<CcGridCell, 'bid' | 'ask'>): number {
  return Math.round(((cell.bid + cell.ask) / 2) * 100 * grid.contracts * 100) / 100;
}

// ── Yield ────────────────────────────────────────────────────────────────────

export function ccPeriodYieldPct(premiumPerShare: number, stockPrice: number | null): number | null {
  return typeof stockPrice === 'number' && stockPrice > 0 ? Math.round((premiumPerShare / stockPrice) * 1000) / 10 : null;
}

export function ccAnnualYieldPct(premiumPerShare: number, stockPrice: number | null, dte: number): number | null {
  if (!(typeof stockPrice === 'number' && stockPrice > 0) || !(dte > 0)) return null;
  return Math.round((premiumPerShare / stockPrice) * (365 / dte) * 100);
}

// ── Pick, minimum pay and Small & safe ───────────────────────────────────────

export type CcCellVerdict = 'pick' | 'small_safe' | 'low_pay' | 'wide';

/**
 * What a cell is, for Dean's minimum. wide: the price gap fails the rule, never a pick. pick: pays at least the minimum.
 * Under the minimum: small_safe when POP clears the bar, else low_pay (pays too little).
 */
export function ccCellVerdict(grid: CcGrid, cell: CcGridCell, minPayChip: number): CcCellVerdict {
  if (cell.wide) return 'wide';
  if (ccCellNumbers(grid, cell).premiumTotal >= ccEffectiveMinPay(minPayChip)) return 'pick';
  return ccPopPct(cell.delta) >= CC_SMALL_SAFE_MIN_POP ? 'small_safe' : 'low_pay';
}

/** The single highest-paying Small & safe call (ties: higher POP, then earlier expiry, then lower strike), or null. */
export function pickSmallAndSafe(grid: CcGrid, minPayChip: number): CcGridCell | null {
  const pool = grid.cells.filter(c => ccCellVerdict(grid, c, minPayChip) === 'small_safe');
  if (pool.length === 0) return null;
  const total = (c: CcGridCell) => ccCellNumbers(grid, c).premiumTotal;
  return pool.reduce((best, c) => {
    if (total(c) !== total(best)) return total(c) > total(best) ? c : best;
    if (c.delta !== best.delta) return c.delta < best.delta ? c : best;
    if (c.dte !== best.dte) return c.dte < best.dte ? c : best;
    return c.strike < best.strike ? c : best;
  }, pool[0]);
}

// ── Card wording ─────────────────────────────────────────────────────────────

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function ccExpirationLabel(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  const month = MONTHS[Number(m[2]) - 1];
  return month ? `${month} ${Number(m[3])}` : iso;
}

const price = (n: number) => (Number.isInteger(n) ? `$${n}` : `$${n.toFixed(2)}`);
const dollars = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;
const perShare = (n: number) => `$${n.toFixed(2)}`;
/** The middle price rounded DOWN to the cent, the same number the premium at fill uses. */
/** The bid/ask gap in cents, e.g. "30¢". */
export const ccGapCents = (bid: number, ask: number): string => `${Math.round((ask - bid) * 100)}¢`;
/**
 * The widest bid/ask gap that still passes, in cents: the larger of 1 cent (one tick) and 10% of the mid, and never over the
 * 50 cent ceiling.
 */
export function ccGapLimitCents(bid: number, ask: number): number {
  const mid = (bid + ask) / 2;
  const limit = Math.max(CC_GAP_FLOOR_DOLLARS, (DEFAULT_CC_RULES.WIDTH_PCT_MAX / 100) * mid);
  // Whole cents, rounded down: gaps come in whole cents, so a 6.75 cent limit means 6 cents is the most that passes.
  return Math.floor(Math.min(limit, DEFAULT_CC_RULES.WIDTH_CEILING) * 100 + 1e-9);
}
export const ccMidPerShare = (bid: number, ask: number) => Math.floor(((bid + ask) / 2) * 100 + 1e-9) / 100;

/** Trader notation: $56C. */
export function ccStrikeLabel(strike: number): string {
  return `${price(strike)}C`;
}

export type CcTone = 'green' | 'amber';

export interface CcFact { label: string; big: string; sub: string; tone: CcTone }

export interface CcCardView {
  verdict: CcCellVerdict;
  /** "SMALL & SAFE" on a Small & safe call, otherwise null. */
  tag: string | null;
  headline: string;
  /** One short line under the headline, or null. */
  note: string | null;
  collect: CcFact;
  keep: CcFact;
  fill: CcFact;
  canReview: boolean;
  /** Lines behind "Why this call", gain if called and yearly yield first. */
  why: string[];
  /** The text on the Review order button's helper line when the button is off. */
  reviewOffNote: string | null;
}

export interface CcCardViewInput {
  grid: CcGrid;
  cell: CcGridCell;
  /** Dean's minimum-pay chip (0 = Any). */
  minPay: number;
  symbol?: string;
  /** The reason line for the call the card chose by itself; left out for a call Dean clicked. */
  reasonLine?: string | null;
  /** True when this cell is the call Small & safe chose by itself. */
  autoSmallSafe?: boolean;
}

export function buildCcCardView(i: CcCardViewInput): CcCardView {
  const { grid, cell } = i;
  const verdict = ccCellVerdict(grid, cell, i.minPay);
  const n = ccCellNumbers(grid, cell);
  const fill = ccFillLabel(cell);
  const pop = ccPopPct(cell.delta);
  const strike = ccStrikeLabel(cell.strike);
  const exp = ccExpirationLabel(cell.expiration);
  const minLabel = dollars(ccEffectiveMinPay(i.minPay));
  const minPhrase = ccMinPayPhrase(i.minPay);
  const sym = i.symbol ?? 'the stock';
  const move = ccStockMovePct(grid, cell);
  const range = ccExpectedFill(grid, cell);

  const headline =
    verdict === 'wide' ? `${strike} · Exp ${exp} · not a pick`
    : verdict === 'low_pay' ? `${strike} · Exp ${exp} · pays too little`
    : `Sell ${grid.contracts} ${strike} · Exp ${exp}`;

  let note: string | null = null;
  if (verdict === 'small_safe') {
    note = i.autoSmallSafe ? `Nothing pays ${minLabel}. Best call with POP ${CC_SMALL_SAFE_MIN_POP}%+ above your cost.` : `Pays under ${minPhrase}. POP ${CC_SMALL_SAFE_MIN_POP}%+ and above your cost.`;
  } else if (verdict === 'low_pay') {
    note = `Pays ${dollars(n.premiumTotal)}, under ${minPhrase}.`;
  }

  const tone: CcTone = verdict === 'pick' ? 'green' : 'amber';
  const collect: CcFact = {
    label: 'COLLECT',
    big: verdict === 'wide' ? `About ${dollars(n.premiumTotal)}` : dollars(n.premiumTotal),
    sub: `${verdict === 'wide' ? 'the bid price · ' : ''}bid ${perShare(cell.bid)} · mid ${perShare(ccMidPerShare(cell.bid, cell.ask))} · ask ${perShare(cell.ask)}`,
    tone,
  };
  const keep: CcFact = {
    label: 'KEEP YOUR SHARES',
    big: `POP ${pop}%`,
    sub: move !== null && move > 0 ? `called only if ${sym} rises ${move.toFixed(1)}%, to ${price(cell.strike)}` : `called only if ${sym} finishes above ${price(cell.strike)}`,
    tone: ccPopTone(pop) === 'green' ? 'green' : 'amber',
  };
  const gap = fill.gapPct === null ? '' : `${ccGapCents(cell.bid, cell.ask)} (${fill.gapPct.toFixed(1)}%)`;
  const gapOnly = fill.gapPct === null ? '' : `${ccGapCents(cell.bid, cell.ask)} = ${fill.gapPct.toFixed(1)}%`;
  const fillFact: CcFact =
    fill.label === 'too_big'
      ? {
          label: 'FILL', big: CC_FILL_TEXT.too_big, tone: 'amber',
          sub: `gap ${gapOnly} of the price, the most allowed is ${ccGapLimitCents(cell.bid, cell.ask)}¢ · the ${dollars(ccMidTotal(grid, cell))} middle price is not real`,
        }
      : {
          label: 'FILL', big: CC_FILL_TEXT[fill.label], tone: 'green',
          sub: `price gap ${gap} · ${range.low === range.high ? `expect about ${dollars(range.high)}` : `expect ${dollars(range.low)} to ${dollars(range.high)}`}`,
        };

  const why: string[] = [];
  if (n.calledAwayTotal !== null && grid.basis !== null) {
    why.push(`If called: shares sold at ${price(cell.strike)}, a gain of ${dollars(n.calledAwayTotal)} on your ${price(grid.basis)} cost, including the ${dollars(n.premiumTotal)} you collect.`);
    if (n.notCalledBasis !== null) why.push(`If not called: you keep the ${dollars(n.premiumTotal)} and your cost drops to $${n.notCalledBasis.toFixed(2)} a share.`);
  }
  const period = ccPeriodYieldPct(n.premiumPerShare, grid.stockPrice);
  const annual = ccAnnualYieldPct(n.premiumPerShare, grid.stockPrice, cell.dte);
  if (period !== null && annual !== null) why.push(`Yield: ${period.toFixed(1)}% in ${cell.dte} days, about ${annual}% a year.`);
  if (i.reasonLine) why.push(`Why this strike: ${i.reasonLine}`);

  const canReview = verdict === 'pick' || verdict === 'small_safe';
  const reviewOffNote =
    verdict === 'wide' ? 'Pick a green-outline cell instead.'
    : verdict === 'low_pay' ? (n.premiumTotal < CC_HARD_MIN_PAY ? `Nothing under $${CC_HARD_MIN_PAY} is ever recommended.` : `Lower your minimum to ${dollars(n.premiumTotal)} or less to review this one.`)
    : null;

  return { verdict, tag: verdict === 'small_safe' ? 'SMALL & SAFE' : null, headline, note, collect, keep, fill: fillFact, canReview, why, reviewOffNote };
}

// ── Timing and "outside your view" (CC-PMCC-GUIDANCE-0001 slice A2: stock card and scan row) ──────────────────────────


export interface CcTimingNote {
  state: CcRsiChipState;
  /** "Ready", "Wait" or "Recovery": the chip text after "Calls:". */
  chip: 'Ready' | 'Wait' | 'Recovery';
  /** Null when calls are fine to look at (Ready); otherwise "NO CALL TO SELL YET". */
  title: string | null;
  lines: string[];
}

/** Plain-words timing for a holding: RSI against the cutoff, then price against the cost basis. Never a block, a signal. */
export function ccTimingNote(i: { symbol: string; rsi: number | null | undefined; price: number | null | undefined; basis: number | null | undefined; cutoff: number }): CcTimingNote {
  const chip = ccRsiChip({ rsi: i.rsi, price: i.price, costBasis: i.basis, cutoff: i.cutoff });
  const lines: string[] = [];
  const below = typeof i.basis === 'number' && i.basis > 0 && typeof i.price === 'number' && i.price > 0 && i.price < i.basis;
  if (chip.state === 'wait') {
    lines.push(typeof i.rsi === 'number' ? `${i.symbol} RSI is ${Math.round(i.rsi)}, below your ${i.cutoff} cutoff. Wait for RSI to reach ${i.cutoff}.` : 'Daily RSI is unavailable, so timing cannot be confirmed.');
  }
  if (below) {
    const pct = (((i.basis as number) - (i.price as number)) / (i.basis as number)) * 100;
    lines.push(`${chip.state === 'wait' ? 'Even then, no' : 'No'} call above your $${(i.basis as number).toFixed(2)} cost fits yet: ${i.symbol} is at $${(i.price as number).toFixed(2)}, ${pct.toFixed(1)}% below it.`);
  }
  return { state: chip.state, chip: chip.label, title: lines.length > 0 ? 'NO CALL TO SELL YET' : null, lines };
}

/** The POP range a goal asks for, e.g. "65 to 80%". */
export function ccGoalPopRange(goal: CcGoal): { lo: number; hi: number } {
  return { lo: Math.round((1 - CC_GOALS[goal].max) * 100), hi: Math.round((1 - CC_GOALS[goal].min) * 100) };
}

export interface CcOutsideRow { cell: CcGridCell; why: string }

/** Every call that is not in the goal's POP range, or whose price gap is too big, with one plain sentence each. Information only, never a pick. */
export function ccOutsideTheView(grid: CcGrid, goal: CcGoal): CcOutsideRow[] {
  const { lo, hi } = ccGoalPopRange(goal);
  const rows: CcOutsideRow[] = [];
  for (const cell of grid.cells) {
    const pop = ccPopPct(cell.delta);
    if (cell.wide) {
      rows.push({ cell, why: `Price gap ${ccGapCents(cell.bid, cell.ask)}, the most allowed here is ${ccGapLimitCents(cell.bid, cell.ask)}¢` });
    } else if (pop > hi) {
      rows.push({ cell, why: `Strike too far above the price: POP ${pop}%, your view wants ${lo} to ${hi}%` });
    } else if (pop < lo) {
      rows.push({ cell, why: `Strike too close to the price: POP ${pop}%, your view wants ${lo} to ${hi}%` });
    }
  }
  return rows.sort((a, b) => a.cell.expiration.localeCompare(b.cell.expiration) || a.cell.strike - b.cell.strike);
}

/** ccStockMovePct, kept here so callers import one module. */
export function ccStockMovePctSafe(grid: CcGrid, cell: Pick<CcGridCell, 'strike'>): number | null {
  return ccStockMovePct(grid, cell);
}
