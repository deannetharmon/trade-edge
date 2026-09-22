import { describe, expect, it } from 'vitest';
import { buildStrategyPerformanceReport } from '../strategyPerformance';
import type { ClosedTrade } from '@/lib/tradeLog/types';
const trade = (over: Partial<ClosedTrade> = {}): ClosedTrade => ({ id: 'one', symbol: 'SPY', strategy: 'CSP', openDate: '2026-01-01', closeDate: '2026-01-10', openTime: '10:00', openDow: 1, expiry: '2026-01-17', holdDays: 9, strikes: '500P', creditReceived: 100, closePrice: 0, pnl: 100, pnlPct: 100, outcome: 'WIN', quantity: 1, fees: 0, dteAtClose: 7, dteAtEntry: 16, exitType: 'TARGET_HIT', reconstructionStatus: 'COMPLETE', closureMechanism: 'CLOSED', openedQuantity: 1, closedQuantity: 1, remainingQuantity: 0, sourceTransactionIds: [], ...over });
describe('strategy performance report', () => {
  it('does not mislabel short calls as covered calls or PMCCs', () => {
    const report = buildStrategyPerformanceReport([trade(), trade({ id: 'short', strategy: 'SHORT_CALL', pnl: 25 })]);
    expect(report.rows.find(r => r.strategy === 'CSP')).toMatchObject({ closedLifecycles: 1, realizedPnl: 100, insufficientHistory: true });
    expect(report.rows.find(r => r.strategy === 'CC')?.closedLifecycles).toBe(0);
    expect(report.rows.find(r => r.strategy === 'PMCC')?.closedLifecycles).toBe(0);
    expect(report.rows.find(r => r.strategy === 'UNCLASSIFIED')?.closedLifecycles).toBe(1);
  });
  it('excludes incomplete reconstruction from aggregates', () => {
    const report = buildStrategyPerformanceReport([trade(), trade({ id: 'incomplete', pnl: -999, reconstructionStatus: 'INCOMPLETE' })]);
    expect(report.includedTrades).toBe(1); expect(report.excludedIncompleteTrades).toBe(1);
  });
});
