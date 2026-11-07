// components/portfolio-data/__tests__/EquityHoldingsRsi.test.tsx

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { THEMES } from '@/lib/theme';
import type { EquityHolding, PortfolioSnapshot } from '@/lib/portfolio-snapshot/types';
import type { HoldingRsiMap } from '../useHoldingRsi';

let rsiMap: HoldingRsiMap = {};
vi.mock('../useHoldingRsi', () => ({ useHoldingRsi: () => rsiMap }));

import { EquityHoldingsSection } from '../EquityHoldingsSection';

const holding = (overrides: Partial<EquityHolding> = {}): EquityHolding => ({
  accountNumber: 'ACC1', symbol: 'TQQQ', direction: 'Long', quantity: 100,
  settledQuantity: null, basis: 80, basisComplete: true,
  currentPrice: 71.2, marketValue: 7120, unrealizedPnl: -880,
  quoteAsOf: null, staleQuote: true, deliverable: 'standard', dataQualityWarnings: [],
  ...overrides,
});

const snapshot = (equities: EquityHolding[]): PortfolioSnapshot => ({
  accountNumber: 'ACC1', asOf: '2026-11-06T18:00:00.000Z', quoteAsOf: null,
  equities, options: [], workingOrders: [],
  coverageEvidence: {
    existingShortCallsBySymbol: {}, workingShortCallsBySymbol: {}, unclassifiedSymbols: [],
    complete: true, warnings: [], hasAdjustedOrUnknownDeliverable: false,
  },
  dataQuality: { status: 'ok', staleQuotes: true, warnings: [] },
  freshness: 'current', lastSuccessfulAsOf: '2026-11-06T18:00:00.000Z',
});

const tile = (symbol = 'TQQQ', direction = 'Long') => screen.getByTestId(`equity-rsi-${symbol}-${direction}`);

describe('EquityHoldingsSection RSI tile (STOCK-RSI-0001 A)', () => {
  beforeEach(() => { rsiMap = {}; window.localStorage.clear(); });

  it('shows the rounded RSI, a neutral arrow and "Calls: Wait" below the cutoff', () => {
    rsiMap = { TQQQ: { rsi: 46.6, previous: 43.9, direction: 'up' } };
    render(<EquityHoldingsSection snapshot={snapshot([holding()])} th={THEMES.dark} />);
    expect(tile()).toHaveTextContent('RSI (14d)');
    expect(tile()).toHaveTextContent('47');
    expect(screen.getByLabelText('rising')).toBeInTheDocument();
    expect(screen.getByText('Calls: Wait')).toBeInTheDocument();
  });

  it('does not color the number or the arrow; only the chip carries color', () => {
    rsiMap = { TQQQ: { rsi: 46.6, previous: 43.9, direction: 'up' } };
    render(<EquityHoldingsSection snapshot={snapshot([holding()])} th={THEMES.dark} />);
    expect(screen.getByText('47').className).not.toMatch(/emerald|red|amber|sky/);
    expect(screen.getByLabelText('rising').className).not.toMatch(/emerald|red|amber|sky/);
  });

  it('reads "Calls: Ready" at or above the cutoff when the price is at or above basis', () => {
    rsiMap = { TQQQ: { rsi: 56, previous: 58, direction: 'down' } };
    render(<EquityHoldingsSection snapshot={snapshot([holding({ currentPrice: 85 })])} th={THEMES.dark} />);
    expect(screen.getByText('Calls: Ready')).toBeInTheDocument();
    expect(screen.getByLabelText('falling')).toBeInTheDocument();
  });

  it('reads "Calls: Recovery" at or above the cutoff when the price is below basis', () => {
    rsiMap = { TQQQ: { rsi: 56, previous: 56.2, direction: 'flat' } };
    render(<EquityHoldingsSection snapshot={snapshot([holding()])} th={THEMES.dark} />);
    expect(screen.getByText('Calls: Recovery')).toBeInTheDocument();
    expect(screen.getByLabelText('flat')).toBeInTheDocument();
  });

  it('honors the saved covered-call cutoff', () => {
    window.localStorage.setItem('te-cc-rsi-cutoff', '40');
    rsiMap = { TQQQ: { rsi: 47, previous: 44, direction: 'up' } };
    render(<EquityHoldingsSection snapshot={snapshot([holding({ currentPrice: 85 })])} th={THEMES.dark} />);
    expect(screen.getByText('Calls: Ready')).toBeInTheDocument();
  });

  it('shows "—" with no chip while loading or when RSI cannot be computed', () => {
    rsiMap = { TQQQ: undefined };
    const { unmount } = render(<EquityHoldingsSection snapshot={snapshot([holding()])} th={THEMES.dark} />);
    expect(tile()).toHaveTextContent('—');
    expect(screen.queryByText(/Calls:/)).not.toBeInTheDocument();
    unmount();
    rsiMap = { TQQQ: null };
    render(<EquityHoldingsSection snapshot={snapshot([holding()])} th={THEMES.dark} />);
    expect(tile()).toHaveTextContent('—');
    expect(screen.queryByText(/Calls:/)).not.toBeInTheDocument();
  });

  it('shows RSI for short stock but no covered-call chip', () => {
    rsiMap = { TSLA: { rsi: 61, previous: 55, direction: 'up' } };
    render(<EquityHoldingsSection snapshot={snapshot([holding({ symbol: 'TSLA', direction: 'Short', quantity: 50 })])} th={THEMES.dark} />);
    expect(tile('TSLA', 'Short')).toHaveTextContent('61');
    expect(screen.queryByText(/Calls:/)).not.toBeInTheDocument();
  });

  it('shows basis to current price with the current price bold and a neutral percent caption', () => {
    render(<EquityHoldingsSection snapshot={snapshot([holding()])} th={THEMES.dark} />);
    expect(screen.getByText('$80.00')).toBeInTheDocument();
    expect(screen.getByLabelText('to')).toHaveTextContent('→');
    expect(screen.getByText('$71.20').className).toMatch(/font-bold/);
    const caption = screen.getByText('−11.0% since you bought');
    expect(caption.className).not.toMatch(/emerald|red|amber|sky/);
  });

  it('shows a gain with a plus sign', () => {
    render(<EquityHoldingsSection snapshot={snapshot([holding({ currentPrice: 88 })])} th={THEMES.dark} />);
    expect(screen.getByText('+10.0% since you bought')).toBeInTheDocument();
  });

  it('says "Basis unavailable" and shows the price alone when the basis is incomplete', () => {
    render(<EquityHoldingsSection snapshot={snapshot([holding({ basis: null, basisComplete: false })])} th={THEMES.dark} />);
    expect(screen.getByText('Basis unavailable')).toBeInTheDocument();
    expect(screen.queryByLabelText('to')).not.toBeInTheDocument();
    expect(screen.getByText('$71.20')).toBeInTheDocument();
  });

  it('falls back to the average basis alone when the price is unavailable', () => {
    render(<EquityHoldingsSection snapshot={snapshot([holding({ currentPrice: null, marketValue: null, unrealizedPnl: null })])} th={THEMES.dark} />);
    expect(screen.getByText('Avg basis $80.00')).toBeInTheDocument();
  });

  it('ignores an unknown cost basis for the Recovery test (never guesses)', () => {
    rsiMap = { TQQQ: { rsi: 56, previous: 55, direction: 'up' } };
    render(<EquityHoldingsSection snapshot={snapshot([holding({ basis: null, basisComplete: false })])} th={THEMES.dark} />);
    expect(screen.getByText('Calls: Ready')).toBeInTheDocument();
  });
});
