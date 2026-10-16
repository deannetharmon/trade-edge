// lib/portfolio-data/balanceChange.ts

// BALANCE-CHANGE-0001 (Dean, 2026-10-16): the Balances chart showed a drop the app could not explain. Each stored day
// carries net liq, cash and net options value, so the change between two days is split into where it came from:
// cash, options value, everything else (stock and other holdings), and money moved in or out. Pure; display only.

import type { MoneyMovement } from './balancePerformance';

export interface BalanceSnapshot {
  date: string; // YYYY-MM-DD
  netLiquidatingValue: number;
  cashBalance: number;
  netOptionsValue: number;
}

export interface BalanceChangeRow {
  fromDate: string;
  toDate: string;
  gapDays: number;
  netLiq: number; // total change in net liq
  cash: number;
  options: number;
  other: number; // net liq change not explained by cash or options (stock and other holdings)
  moved: number; // deposits (+) and withdrawals (-) dated after fromDate and up to toDate
  trading: number; // netLiq - moved: the change from trading and marks, with money movements taken out
  live: boolean;
}

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86400000);
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Changes between consecutive stored days, then from the last stored day to the live balance, newest last.
 * `history` is closed days only; `live` is today's balances. Returns at most `limit` rows (the most recent).
 */
export function balanceChangeRows(
  history: readonly BalanceSnapshot[],
  live: Omit<BalanceSnapshot, 'date'> | null,
  todayNy: string,
  movements: readonly MoneyMovement[],
  limit = 8,
): BalanceChangeRow[] {
  const points: Array<BalanceSnapshot & { live: boolean }> = history
    .filter((d) => d.date < todayNy && d.netLiquidatingValue !== 0)
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((d) => ({ ...d, live: false }));
  if (live && Number.isFinite(live.netLiquidatingValue) && live.netLiquidatingValue !== 0) points.push({ date: todayNy, ...live, live: true });
  const rows: BalanceChangeRow[] = [];
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    const netLiq = b.netLiquidatingValue - a.netLiquidatingValue;
    const cash = b.cashBalance - a.cashBalance;
    const options = b.netOptionsValue - a.netOptionsValue;
    const moved = movements.filter((m) => m.date > a.date && m.date <= b.date).reduce((n, m) => n + m.amount, 0);
    rows.push({
      fromDate: a.date,
      toDate: b.date,
      gapDays: daysBetween(a.date, b.date),
      netLiq: round2(netLiq),
      cash: round2(cash),
      options: round2(options),
      other: round2(netLiq - cash - options),
      moved: round2(moved),
      trading: round2(netLiq - moved),
      live: b.live,
    });
  }
  return rows.slice(-limit);
}
