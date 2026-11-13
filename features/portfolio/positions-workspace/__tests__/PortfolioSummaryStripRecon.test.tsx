// features/portfolio/positions-workspace/__tests__/PortfolioSummaryStripRecon.test.tsx

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Position, PositionLeg } from '@/lib/portfolio-data/types';
import type { EquityHolding } from '@/lib/portfolio-snapshot/types';
import { buildPortfolioSummary } from '../model/portfolioSummary';
import { PortfolioSummaryStrip } from '../PortfolioSummaryStrip';

const NOW = Date.parse('2026-11-13T12:00:00Z');
const leg = { symbol: 'TQQQ  261120C00062000', optionType: 'C', strikePrice: 62, direction: 'Short', quantity: 1, avgOpenPrice: 1.55, currentPrice: 2.37, closePrice: 2.2, openedAt: '2026-11-01T15:00:00Z' } as PositionLeg;
const call = { key: 'TQQQ-CC', symbol: 'TQQQ', strategy: 'CALL', quantity: 1, dte: 14, entryDate: '2026-11-01', entryPriceEffect: 'Credit', entryEconomicsComplete: true, entryCredit: 155, pnl: -82, theta: 0.1, maxRisk: 6045, maxRiskReliable: true, structureAmbiguous: false, identity: { quantity: 1 }, snapshotHistory: [], legs: [leg] } as unknown as Position;
const shares = { accountNumber: 'A', symbol: 'TQQQ', direction: 'Long', quantity: 200, settledQuantity: 200, basis: 78.75, basisComplete: true, currentPrice: 60.13, marketValue: 12026, unrealizedPnl: -3725, quoteAsOf: null, staleQuote: false, deliverable: 'standard', dataQualityWarnings: [] } as unknown as EquityHolding;

describe('RECON-0002 and RECON-0004 on the strip', () => {
  const summary = buildPortfolioSummary({ rows: [{ position: call, needsAttention: false }], equities: [shares], pendingOrders: [], cashBalance: 22497, netLiquidity: 35378, optionBuyingPower: 6931, nowMs: NOW });

  it('the covered call tile shows its capital as negative premium kept, not a positive amount or a percent', () => {
    render(<PortfolioSummaryStrip summary={summary} selected={null} onSelect={() => {}} />);
    const tiles = screen.getAllByTestId('tile-capital').map(n => n.textContent);
    expect(tiles.some(t => t?.includes('-$155') && t.includes('premium kept') && !t.includes('%'))).toBe(true);
  });

  it('shows cash free next to the buying-power reserve', () => {
    render(<PortfolioSummaryStrip summary={summary} selected={null} onSelect={() => {}} />);
    expect(screen.getByTestId('headline-cash-free')).toHaveTextContent('Cash free 64%');
    expect(screen.getByTestId('headline-reserve')).toHaveTextContent('Reserve 20%');
  });
});
