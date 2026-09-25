// lib/tradeLog/__tests__/strategyBreakdown.test.ts

import { describe, expect, it } from 'vitest';
import { buildStrategyBreakdown } from '../strategyBreakdown';
import { TRADE_STRATEGY_ORDER } from '../strategyOptions';
import type { ClosedTrade } from '../types';

const trade = (strategy: string, pnl: number, pnlPct: number, outcome: 'WIN' | 'LOSS' = pnl >= 0 ? 'WIN' : 'LOSS'): ClosedTrade =>
  ({ strategy, pnl, pnlPct, outcome }) as unknown as ClosedTrade;

describe('buildStrategyBreakdown', () => {
  it('reports every strategy a closed trade can have, so the rows always add up to the trades (CSP and short calls included)', () => {
    const trades = TRADE_STRATEGY_ORDER.flatMap((s, i) => [trade(s, 100 + i, 10), trade(s, -50, -5)]);
    const rows = buildStrategyBreakdown(trades);
    expect(rows.map(r => r.strategy)).toEqual([...TRADE_STRATEGY_ORDER]);
    expect(rows.reduce((sum, r) => sum + r.total, 0)).toBe(trades.length);
    expect(rows.reduce((sum, r) => sum + r.pnl, 0)).toBeCloseTo(trades.reduce((sum, t) => sum + t.pnl, 0));
  });

  it('a strategy value the model does not list is still reported, never dropped', () => {
    const trades = [trade('BPS', 10, 5), trade('PMCC_FUTURE', 20, 8)];
    const rows = buildStrategyBreakdown(trades);
    expect(rows.map(r => r.strategy)).toEqual(['BPS', 'PMCC_FUTURE']);
    expect(rows[1]).toMatchObject({ label: 'PMCC_FUTURE', total: 1 });
    expect(rows.reduce((s, r) => s + r.total, 0)).toBe(2);
  });

  it('computes wins, win rate, P&L and average percent per strategy', () => {
    const rows = buildStrategyBreakdown([trade('CSP', 200, 40), trade('CSP', -100, -20), trade('CSP', 50, 10), trade('BPS', 10, 2)]);
    const csp = rows.find(r => r.strategy === 'CSP')!;
    expect(csp).toMatchObject({ label: 'CSP', total: 3, wins: 2, pnl: 150 });
    expect(csp.winRate).toBeCloseTo(2 / 3);
    expect(csp.avgPnlPct).toBeCloseTo(10);
  });

  it('omits strategies with no trades and handles an empty list', () => {
    expect(buildStrategyBreakdown([trade('IC', 5, 1)]).map(r => r.strategy)).toEqual(['IC']);
    expect(buildStrategyBreakdown([])).toEqual([]);
  });
});
