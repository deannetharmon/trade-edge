// lib/wheel/priceHistory.ts
//
// WHEEL-SYSTEM-0003 Slice B -- a name's own price-history check: how far has it actually fallen,
// in its own history? Pure functions, integer arithmetic throughout (closes converted to whole
// mills -- round(c x 10000) -- before any ratio is taken), so a boundary case never depends on
// float rounding.
//
// Information only (Ian's ruling, decision 1): nothing here ever blocks a name or changes a
// verdict. It informs the per-name Drop box (Slice A) via a suggestion the trader can take or
// leave with one click.

const WINDOW_DAYS = 21;
const TRADING_DAYS_PER_YEAR = 251;
const SHORT_HISTORY_YEARS = 3;

export interface PriceHistoryStats {
  /** The lowest 21-trading-day return seen, in basis points (negative). */
  worstMonthBps: number;
  /** The lowest point below the running peak, in basis points (negative or zero). */
  maxDrawdownBps: number;
  /** Share of 21-day windows at or below -30%, in basis points (10000 = 100%). */
  share30Bps: number;
  /** Years of history covered, one decimal (closes.length / 251). */
  years: number;
  /** Fewer than 3 years of history -- a shorter window understates risk. */
  shortHistory: boolean;
}

/** Needs at least one full 21-day window: 22 closes (index 0 through 21). Fewer -> unavailable. */
export const MIN_CLOSES_FOR_HISTORY = WINDOW_DAYS + 1;

/**
 * Analyzes a symbol's own daily closes (oldest first, dollars). Returns null when there are too
 * few closes for even one 21-day window -- the caller shows "history unavailable", never a guess.
 */
export function analyzePriceHistory(closes: readonly number[]): PriceHistoryStats | null {
  if (closes.length < MIN_CLOSES_FOR_HISTORY) return null;

  const mills = closes.map((c) => Math.round(c * 10_000));

  let worstMonthBps = Infinity;
  let windowsAtOrBelow30 = 0;
  let windowCount = 0;
  for (let i = 0; i + WINDOW_DAYS < mills.length; i++) {
    const ret = Math.floor((mills[i + WINDOW_DAYS] * 10_000) / mills[i]) - 10_000;
    if (ret < worstMonthBps) worstMonthBps = ret;
    windowCount++;
    if (ret <= -3_000) windowsAtOrBelow30++;
  }

  let peak = mills[0];
  let maxDrawdownBps = 0;
  for (const c of mills) {
    if (c > peak) peak = c;
    const dd = Math.floor((c * 10_000) / peak) - 10_000;
    if (dd < maxDrawdownBps) maxDrawdownBps = dd;
  }

  const share30Bps = windowCount > 0 ? Math.round((windowsAtOrBelow30 * 10_000) / windowCount) : 0;
  const years = Math.round((closes.length / TRADING_DAYS_PER_YEAR) * 10) / 10;

  return { worstMonthBps, maxDrawdownBps, share30Bps, years, shortHistory: years < SHORT_HISTORY_YEARS };
}

/**
 * The suggested per-name drop: the worst month rounded UP to the next 5%, never below the
 * plan-wide drop, capped at 95% (Ian/ticket, decisions 1 and 3: approved).
 */
export function suggestedDropBps(worstMonthBps: number, planDropBps: number): number {
  const rounded = Math.ceil(Math.abs(worstMonthBps) / 500) * 500;
  return Math.min(9_500, Math.max(planDropBps, rounded));
}

/**
 * How many basis points worse than the row's own effective drop the worst month is. Positive
 * means the history is worse than assumed; zero or negative means the assumed drop already
 * covers it. Ian's ruling: the warning chip is a margin over THIS number, not a flat constant --
 * a name already sized conservatively (its own Drop override covers its history) should read
 * calm, not alarm regardless of the raw worst-month number.
 */
export function worseThanEffectiveDropBps(worstMonthBps: number, effectiveDropBps: number): number {
  return Math.abs(worstMonthBps) - effectiveDropBps;
}
