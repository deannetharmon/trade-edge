import type { ClosedTrade } from '@/lib/tradeLog/types';

/** Broker history must not infer covered-call or PMCC identity from a short call alone. */
export type ReportStrategy = 'CSP' | 'BPS' | 'BCS' | 'IC' | 'CC' | 'PMCC' | 'LEAP' | 'UNCLASSIFIED';
export const REPORT_STRATEGIES: readonly ReportStrategy[] = ['CSP', 'CC', 'PMCC', 'LEAP', 'BPS', 'BCS', 'IC', 'UNCLASSIFIED'];

export interface StrategyPerformanceRow {
  strategy: ReportStrategy; label: string; closedLifecycles: number; realizedPnl: number;
  winRate: number | null; averageWin: number | null; averageLoss: number | null; profitFactor: number | null;
  averageHoldDays: number | null; insufficientHistory: boolean; classificationNote: string | null;
}
export interface StrategyPerformanceReport { rows: StrategyPerformanceRow[]; includedTrades: number; excludedIncompleteTrades: number; unclassifiedShortCalls: number; }

const labels: Record<ReportStrategy, string> = {
  CSP: 'Cash-secured puts', CC: 'Covered calls', PMCC: 'PMCC', LEAP: 'Standalone LEAPS',
  BPS: 'Bull put spreads', BCS: 'Bear call spreads', IC: 'Iron condors', UNCLASSIFIED: 'Needs classification',
};
const round = (n: number) => Math.round(n * 100) / 100;
function strategyFor(t: ClosedTrade): ReportStrategy {
  if (t.strategy === 'CSP' || t.strategy === 'BPS' || t.strategy === 'BCS' || t.strategy === 'IC') return t.strategy;
  return 'UNCLASSIFIED';
}

export function buildStrategyPerformanceReport(trades: ClosedTrade[]): StrategyPerformanceReport {
  const complete = trades.filter(t => !t.excluded && t.reconstructionStatus === 'COMPLETE');
  const rows = REPORT_STRATEGIES.map(strategy => {
    const group = complete.filter(t => strategyFor(t) === strategy);
    const wins = group.filter(t => t.pnl > 0), losses = group.filter(t => t.pnl < 0), count = group.length;
    const grossWin = wins.reduce((s, t) => s + t.pnl, 0), grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));
    const hasUnclassifiedShortCalls = strategy === 'UNCLASSIFIED' && group.some(t => t.strategy === 'SHORT_CALL');
    return {
      strategy, label: labels[strategy], closedLifecycles: count, realizedPnl: round(group.reduce((s, t) => s + t.pnl, 0)),
      winRate: count ? wins.length / count : null,
      averageWin: wins.length ? round(grossWin / wins.length) : null,
      averageLoss: losses.length ? round(losses.reduce((s, t) => s + t.pnl, 0) / losses.length) : null,
      profitFactor: grossLoss > 0 ? round(grossWin / grossLoss) : null,
      averageHoldDays: count ? round(group.reduce((s, t) => s + t.holdDays, 0) / count) : null,
      insufficientHistory: count > 0 && count < 5,
      classificationNote: hasUnclassifiedShortCalls ? 'Short-call history is present, but broker coverage/foundation linkage is not yet available.' : null,
    };
  });
  return { rows, includedTrades: complete.length, excludedIncompleteTrades: trades.filter(t => !t.excluded && t.reconstructionStatus !== 'COMPLETE').length, unclassifiedShortCalls: complete.filter(t => t.strategy === 'SHORT_CALL').length };
}
