// lib/portfolio-data/balancePerformance.ts

// BALANCE-CHART-0001 (Dean, 2026-10-06): the Balances chart showed a $5k withdrawal as a trading loss. Pure helpers:
//  * money movements (deposits, withdrawals, transfers) from TastyTrade transactions, signed (+ in, - out);
//  * a "performance" series = net liq with every money movement since the first plotted day taken back out, so the
//    line moves only with trading results; the raw net-liq series stays available;
//  * only CLOSED days are stored (a day's snapshot is final after it ends); the live balance is the last point.

export interface BalanceDayPoint {
  date: string; // YYYY-MM-DD
  netLiquidatingValue: number;
}

export interface MoneyMovement {
  date: string; // YYYY-MM-DD (New York)
  amount: number; // + deposit / transfer in, - withdrawal / transfer out
  label: string;
}

const MOVEMENT_SUB_TYPES = /deposit|withdraw|transfer|ach|wire|journal/i;

function newYorkDate(iso: string): string | null {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(ms);
}

/** Deposits / withdrawals / transfers only. Interest, fees and trades are performance and stay in the line. */
export function extractMoneyMovements(transactions: readonly Record<string, unknown>[]): MoneyMovement[] {
  const out: MoneyMovement[] = [];
  transactions.forEach((tx) => {
    if (tx['transaction-type'] !== 'Money Movement') return;
    const sub = String(tx['transaction-sub-type'] ?? '');
    if (!MOVEMENT_SUB_TYPES.test(sub)) return;
    const value = Number(tx['net-value'] ?? tx.value);
    if (!Number.isFinite(value) || value === 0) return;
    const effect = String(tx['net-value-effect'] ?? tx['value-effect'] ?? '');
    if (effect !== 'Credit' && effect !== 'Debit') return;
    const when = typeof tx['executed-at'] === 'string' ? newYorkDate(tx['executed-at']) : typeof tx['transaction-date'] === 'string' ? tx['transaction-date'] : null;
    if (!when) return;
    const amount = effect === 'Credit' ? Math.abs(value) : -Math.abs(value);
    out.push({ date: when, amount, label: `${amount < 0 ? '−' : '+'}$${Math.abs(amount).toLocaleString(undefined, { maximumFractionDigits: 2 })} ${sub.toLowerCase()}` });
  });
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Performance series: each day's net liq minus the money moved in (plus money moved out) after the first plotted day,
 * so the first point equals net liq and a withdrawal does not show as a loss. A movement dated on a plotted day counts
 * on that day (snapshots are end of day).
 */
export function performanceSeries(days: readonly BalanceDayPoint[], movements: readonly MoneyMovement[]): BalanceDayPoint[] {
  if (days.length === 0) return [];
  const start = days[0].date;
  return days.map((d) => {
    const moved = movements.filter((m) => m.date > start && m.date <= d.date).reduce((sum, m) => sum + m.amount, 0);
    return { date: d.date, netLiquidatingValue: d.netLiquidatingValue - moved };
  });
}

/** Snapshots worth storing: completed days only, never zero. */
export function closedDaysOnly<T extends BalanceDayPoint>(days: readonly T[], todayNy: string): T[] {
  return days.filter((d) => d.date < todayNy && d.netLiquidatingValue !== 0);
}

/** Stored history plus today's live balance as the last point (replacing any stored entry for today). */
export function withLivePoint(history: readonly BalanceDayPoint[], todayNy: string, liveNetLiq: number | null): BalanceDayPoint[] {
  const past = history.filter((d) => d.date < todayNy);
  return liveNetLiq != null && Number.isFinite(liveNetLiq) && liveNetLiq !== 0 ? [...past, { date: todayNy, netLiquidatingValue: liveNetLiq }] : past;
}

export function todayNewYork(nowMs: number): string {
  return newYorkDate(new Date(nowMs).toISOString()) as string;
}
