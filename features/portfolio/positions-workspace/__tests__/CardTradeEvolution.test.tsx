// features/portfolio/positions-workspace/__tests__/CardTradeEvolution.test.tsx

// TRADE-EVOLUTION-CARDS-0001: "$X invested" on the card face, and the Trade evolution panel inside Show detail (RSI on every option card).

import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import { PositionCards } from '../PositionCards';
import type { Position } from '@/lib/portfolio-data/types';

const days = [...Array(40)].map((_, i) => { const d = new Date(Date.UTC(2026, 8, 25 + i)); return { date: d.toISOString().slice(0, 10), rsi: 40 + i / 2 }; });
vi.mock('@/components/portfolio-data/useHoldingRsi', () => ({ useHoldingRsi: () => ({ AAA: { rsi: 54.4, previous: 51, direction: 'up', points: days } }) }));

const leg = (direction: 'Long' | 'Short', optionType: 'C' | 'P', extra: Record<string, unknown> = {}) => ({ symbol: 'x', optionType, strikePrice: 140, direction, quantity: 1, avgOpenPrice: 1, currentPrice: 1, openedAt: `${days[5].date}T15:00:00Z`, ...extra });
const spread = { key: 'k1', symbol: 'AAA', strategy: 'Bull Put Spread', legs: [leg('Short', 'P'), leg('Long', 'P', { strikePrice: 135 })], entryPriceEffect: 'Credit', identity: { quantity: 1 }, maxRiskReliable: true, maxRisk: 400, dte: 30, entryDte: 45, dteAtEntry: 45, quantity: 1,
  deltaAtEntry: -0.3, netDelta: -0.2, ivAtEntry: 40, iv: 35, popAtEntry: 70, pop: 75, otmAtEntry: 8, buffer: 6.1, entrySnapshotCreatedAt: '2026-11-05T14:00:00Z' } as unknown as Position;
const th = { textFaint: '', textMuted: '', border: '' };
const renderCards = (p: Position) => render(<PositionCards positions={[p]} order={c => c} pctOfTarget={() => null} th={th} emptyText="none" />);

describe('Cards: invested and trade evolution', () => {
  it('shows what is invested on the card face for a non-LEAP card', () => {
    renderCards(spread);
    expect(screen.getByTestId('card-invested')).toHaveTextContent('$400 invested');
  });
  it('Show detail opens the Trade evolution panel with the RSI tile on a non-LEAP card', async () => {
    renderCards(spread);
    expect(screen.queryByTestId('card-trade-evolution')).not.toBeInTheDocument();
    await userEvent.click(screen.getByText('Show detail'));
    expect(screen.getByTestId('card-trade-evolution')).toHaveTextContent('first tracked Nov 5');
    expect(screen.getByTestId('evo-delta')).toHaveTextContent('-30→-20 sh-eq');
    expect(screen.getByTestId('evo-rsi')).toHaveTextContent(/→54/);
    expect(screen.getByTestId('evo-otm')).toHaveTextContent('8.0→6.1%');
  });
});

describe('Cards: bought option says what it is worth now', () => {
  const longCall = { key: 'k2', symbol: 'AAA', strategy: 'Long Call', legs: [leg('Long', 'C', { strikePrice: 120 })], entryPriceEffect: 'Debit', entryEconomicsComplete: true, entryCredit: 1000, closeValue: 590, identity: { quantity: 1 }, dte: 400, entryDte: 400, quantity: 1, stockPrice: 100 } as unknown as Position;
  it('reads "Paid $1,000 → worth $590 now" and drops the "% left" note', () => {
    renderCards(longCall);
    expect(screen.getByTestId('card-invested')).toHaveTextContent('Paid $1,000 → worth $590 now');
    expect(screen.queryByText(/% of \$1,000/)).not.toBeInTheDocument();
    expect(screen.getByText('if closed now')).toBeInTheDocument();
  });
  it('a credit card keeps "invested"', () => {
    renderCards(spread);
    expect(screen.getByTestId('card-invested')).toHaveTextContent('$400 invested');
  });
});
