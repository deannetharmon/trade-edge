// features/screener/components/__tests__/WhyRanksHerePanel.test.tsx
//
// SCAN-TOP-0001 -- collapsed by default, risk stays visible, three columns when open, nothing when empty.

import React from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import userEvent from '@testing-library/user-event';
import { WhyRanksHerePanel } from '../WhyRanksHerePanel';
import type { BestOpportunityRow } from '@/features/screener/lib/bestOpportunityRows';

function row(over: Partial<BestOpportunityRow> = {}): BestOpportunityRow {
  return {
    candidateId: 'c1', resultKey: 'k1', rank: 1, symbol: 'SOXL', strategy: 'CSP', expiration: '2026-12-04', dte: 32,
    strikeSummary: '50P', creditDebitLabel: '$407.50 credit', pop: 82, otmPct: 27.9, rocPct: 8.2, relevantLegOi: 727,
    opportunityScore: 82, decisionConfidence: 76, disposition: 'RECOMMEND' as any,
    primaryReason: 'Strong cushion for the premium.', supportingFactors: ['POP above 80%'],
    riskTradeoffs: ['Expiration IVX is elevated'], portfolioConflicts: [], exposureDisclosures: ['Uses $5,000 of cash'],
    rejectionReasons: [], missingInformationDisclosures: [], whatWouldImprove: ['A lower IVX.'],
    ...over,
  } as BestOpportunityRow;
}

describe('SCAN-TOP-0001 WhyRanksHerePanel', () => {
  it('is collapsed by default and opens in place into three labelled columns', async () => {
    render(<WhyRanksHerePanel row={row()} />);
    const toggle = screen.getByRole('button', { name: /Why this ranks here/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Strong cushion for the premium.')).not.toBeInTheDocument();

    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Strong cushion for the premium.')).toBeInTheDocument();
    expect(screen.getByText('+ POP above 80%')).toBeInTheDocument();
    expect(screen.getByText('~ Expiration IVX is elevated')).toBeInTheDocument();
    expect(screen.getByText(/Would improve with: A lower IVX\./)).toBeInTheDocument();
    expect(screen.getByText('ℹ Uses $5,000 of cash')).toBeInTheDocument();
    expect(screen.getByText('Why it ranks here')).toBeInTheDocument();
    expect(screen.getByText('Risk and tradeoffs')).toBeInTheDocument();
    expect(screen.getByText('Portfolio and capital')).toBeInTheDocument();
  });

  it('a portfolio conflict stays visible on the collapsed line', () => {
    render(<WhyRanksHerePanel row={row({ portfolioConflicts: ['Already 30% in semiconductors'] })} />);
    expect(screen.getByTestId('why-conflict-marker')).toHaveTextContent('Portfolio conflict');
    expect(screen.queryByText(/Already 30% in semiconductors/)).not.toBeInTheDocument();
  });

  it('no conflict, no marker', () => {
    render(<WhyRanksHerePanel row={row()} />);
    expect(screen.queryByTestId('why-conflict-marker')).not.toBeInTheDocument();
  });

  it('renders nothing when the advisor has nothing to say', () => {
    const { container } = render(<WhyRanksHerePanel row={row({
      primaryReason: '', supportingFactors: [], riskTradeoffs: [], portfolioConflicts: [], exposureDisclosures: [], whatWouldImprove: [],
    })} />);
    expect(container).toBeEmptyDOMElement();
  });
});
