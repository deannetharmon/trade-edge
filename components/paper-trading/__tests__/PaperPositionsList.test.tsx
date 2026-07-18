// components/paper-trading/__tests__/PaperPositionsList.test.tsx

import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import PaperPositionsList from '../PaperPositionsList';
import type { PaperFillEvidence, PaperTradingPosition } from '@/lib/paper-trading/types';

const NOW = new Date('2026-08-01T00:00:00.000Z');

function fill(value: number): PaperFillEvidence {
  return {
    pricingSource: 'marketable',
    midValue: value,
    marketableValue: value,
    simulatedFillValue: value,
    slippage: 0,
    quoteAgeSeconds: 5,
    staleQuoteConfirmed: false,
    manualOverride: null,
    quoteSnapshot: null,
    evaluatedAt: NOW.toISOString(),
  };
}

function makePosition(overrides: Partial<PaperTradingPosition> = {}): PaperTradingPosition {
  return {
    positionId: 'pos-1',
    idempotencyKey: 'k',
    userId: 'u1',
    symbol: 'SPY',
    strategy: 'CSP',
    legs: [{ legId: 'p', optionType: 'put', strike: 400, expiration: '2026-08-21', openAction: 'sell_to_open' }],
    expiration: '2026-08-21',
    quantity: 1,
    contractMultiplier: 100,
    entryTimestamp: NOW.toISOString(),
    entryFill: fill(300),
    entryCredit: 300,
    capitalReserved: 40000,
    theoreticalMaxLoss: 39700,
    entryRationale: null,
    status: 'open',
    currentMark: null,
    unrealizedPnl: null,
    closeTimestamp: null,
    closeFill: null,
    realizedPnl: null,
    auditRefs: [],
    ...overrides,
  };
}

describe('PaperPositionsList', () => {
  it('shows an empty state when there are no open positions', () => {
    render(<PaperPositionsList openPositions={[]} closedPositions={[]} onChanged={vi.fn()} />);
    expect(screen.getByText(/No open paper positions yet/i)).toBeInTheDocument();
  });

  it('renders an open position with its key figures', () => {
    render(<PaperPositionsList openPositions={[makePosition()]} closedPositions={[]} onChanged={vi.fn()} />);
    expect(screen.getByText(/SPY CSP x1/)).toBeInTheDocument();
    expect(screen.getByText('$300.00')).toBeInTheDocument();
  });

  it('renders a closed position with its realized P/L', () => {
    const closed = makePosition({
      status: 'closed',
      closeTimestamp: NOW.toISOString(),
      closeFill: fill(100),
      realizedPnl: 200,
    });
    render(<PaperPositionsList openPositions={[]} closedPositions={[closed]} onChanged={vi.fn()} />);
    expect(screen.getByText(/closed/)).toBeInTheDocument();
    expect(screen.getByText('$200.00')).toBeInTheDocument();
  });

  it('never renders a Trade/Execute/Submit/Auto-Trade control, and offers only Close/Refresh actions', () => {
    const { container } = render(<PaperPositionsList openPositions={[makePosition()]} closedPositions={[]} onChanged={vi.fn()} />);
    const text = container.textContent ?? '';
    for (const forbidden of ['Submit Order', 'Place Order', 'Execute Trade', 'Auto-Trade', 'Buy Now', 'Sell Now']) {
      expect(text).not.toContain(forbidden);
    }
    expect(screen.getByText('Close Paper Position')).toBeInTheDocument();
    expect(screen.getByText('Refresh Mark')).toBeInTheDocument();
  });
});
