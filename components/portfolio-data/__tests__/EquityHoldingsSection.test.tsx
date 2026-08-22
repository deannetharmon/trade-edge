import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { THEMES } from '@/lib/theme';
import type { EquityHolding, PortfolioSnapshot } from '@/lib/portfolio-snapshot/types';
import { EquityHoldingsSection, isEquityDisplayEnabled } from '../EquityHoldingsSection';

const holding = (overrides: Partial<EquityHolding> = {}): EquityHolding => ({
  accountNumber: 'ACC1', symbol: 'MSFT', direction: 'Long', quantity: 250,
  settledQuantity: null, basis: 300, basisComplete: true,
  currentPrice: 310, marketValue: 77500, unrealizedPnl: 2500,
  quoteAsOf: null, staleQuote: true, deliverable: 'standard', dataQualityWarnings: [],
  ...overrides,
});

const snapshot = (overrides: Partial<PortfolioSnapshot> = {}): PortfolioSnapshot => ({
  accountNumber: 'ACC1', asOf: '2026-08-22T18:00:00.000Z', quoteAsOf: null,
  equities: [holding()], options: [], workingOrders: [],
  coverageEvidence: {
    existingShortCallsBySymbol: {}, workingShortCallsBySymbol: {}, unclassifiedSymbols: [],
    complete: true, warnings: [], hasAdjustedOrUnknownDeliverable: false,
  },
  dataQuality: { status: 'ok', staleQuotes: true, warnings: [] },
  freshness: 'current', lastSuccessfulAsOf: '2026-08-22T18:00:00.000Z',
  ...overrides,
});

describe('EquityHoldingsSection', () => {
  it('keeps acquisition and display flags independently configurable', () => {
    expect(isEquityDisplayEnabled('true')).toBe(true);
    expect(isEquityDisplayEnabled('false')).toBe(false);
    expect(isEquityDisplayEnabled(undefined)).toBe(false);
  });

  it('renders a stock-only holding without calling unknown-freshness economics current', () => {
    render(<EquityHoldingsSection snapshot={snapshot()} th={THEMES.dark} />);
    expect(screen.getByTestId('equity-holding-MSFT-Long')).toHaveTextContent('250 shares');
    expect(screen.getByText('Reference price')).toBeInTheDocument();
    expect(screen.getByText('$310.00')).toBeInTheDocument();
    expect(screen.getAllByText('Unavailable')).toHaveLength(2);
    expect(screen.queryByText('Current price')).not.toBeInTheDocument();
  });

  it('renders incomplete basis honestly', () => {
    render(<EquityHoldingsSection snapshot={snapshot({ equities: [holding({ basis: null, basisComplete: false })] })} th={THEMES.dark} />);
    expect(screen.getByText('Basis incomplete')).toBeInTheDocument();
    expect(screen.getByText('Basis unavailable')).toBeInTheDocument();
  });

  it('keeps short stock visible with zero covered-call capacity', () => {
    render(<EquityHoldingsSection snapshot={snapshot({ equities: [holding({ symbol: 'TSLA', direction: 'Short', quantity: 50 })] })} th={THEMES.dark} />);
    expect(screen.getByTestId('equity-holding-TSLA-Short')).toHaveTextContent('Short Stock');
    expect(screen.getByText('0 contracts')).toBeInTheDocument();
  });

  it('shows current holdings but disables capacity when complete order evidence is unavailable', () => {
    render(<EquityHoldingsSection snapshot={snapshot({
      coverageEvidence: { existingShortCallsBySymbol: {}, workingShortCallsBySymbol: {}, unclassifiedSymbols: [], complete: false, warnings: [], hasAdjustedOrUnknownDeliverable: false },
      dataQuality: { status: 'unavailable', unavailableReason: 'Complete order evidence unavailable.', staleQuotes: true, warnings: [] },
    })} th={THEMES.dark} />);
    expect(screen.getByRole('status')).toHaveTextContent('capacity actions are disabled');
    expect(screen.getAllByText('Unavailable').length).toBeGreaterThan(0);
    expect(screen.getByTestId('equity-holding-MSFT-Long')).toBeInTheDocument();
  });

  it('labels cached holdings with the last successful observation time', () => {
    render(<EquityHoldingsSection snapshot={snapshot({ freshness: 'last-known', lastSuccessfulAsOf: '2026-08-21T18:00:00.000Z' })} th={THEMES.dark} />);
    expect(screen.getByText(/Last known holdings/)).toBeInTheDocument();
    expect(screen.getByText(/Snapshot observed/)).toBeInTheDocument();
  });

  it('renders a truthful unavailable state when snapshot acquisition is disabled', () => {
    render(<EquityHoldingsSection snapshot={null} th={THEMES.dark} />);
    expect(screen.getByRole('status')).toHaveTextContent('unified portfolio snapshot');
  });
});
