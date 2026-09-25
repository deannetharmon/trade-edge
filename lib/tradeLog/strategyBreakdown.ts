// lib/tradeLog/strategyBreakdown.ts
//
// P&L, win rate and average return per strategy for a set of closed trades, used by the Performance page's
// "P&L by Strategy" widget and its AI analysis prompt. One row for every strategy that has trades, in a
// fixed order, and a strategy value the model does not list is still reported (appended), never dropped,
// so the rows always add up to the trade count. (Both places used to hard-code BPS, BCS, IC, SPREAD and
// OTHER, which left out cash-secured puts and short calls.)

import type { ClosedTrade } from './types';
import { TRADE_STRATEGY_LABELS, TRADE_STRATEGY_ORDER } from './strategyOptions';

export interface StrategyBreakdownRow {
  strategy: string;
  label: string;
  total: number;
  wins: number;
  /** 0 to 1 */
  winRate: number;
  pnl: number;
  /** average of each trade's P&L percent */
  avgPnlPct: number;
}

export function buildStrategyBreakdown(trades: readonly ClosedTrade[]): StrategyBreakdownRow[] {
  const known: readonly string[] = TRADE_STRATEGY_ORDER;
  const unexpected = Array.from(new Set(trades.map(t => t.strategy as string).filter(s => !known.includes(s)))).sort();
  return [...known, ...unexpected].flatMap(strategy => {
    const group = trades.filter(t => (t.strategy as string) === strategy);
    if (group.length === 0) return [];
    const wins = group.filter(t => t.outcome === 'WIN').length;
    return [{
      strategy,
      label: (TRADE_STRATEGY_LABELS as Record<string, string>)[strategy] ?? strategy,
      total: group.length,
      wins,
      winRate: wins / group.length,
      pnl: group.reduce((sum, t) => sum + t.pnl, 0),
      avgPnlPct: group.reduce((sum, t) => sum + t.pnlPct, 0) / group.length,
    }];
  });
}
