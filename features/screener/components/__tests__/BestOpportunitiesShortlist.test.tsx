// features/screener/components/__tests__/BestOpportunitiesShortlist.test.tsx
//
// SCREENER-UX-0001 required tests 8-10: Best Opportunities renders a
// collapsed top-3 shortlist (not fully expanded cards), each row is
// keyboard-operable via a real aria-expanded button, and the exact required
// empty-state text renders when there are zero qualified opportunities.

import { describe, expect, it } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { BestOpportunitiesShortlist, pickTopOpportunityIds } from '../BestOpportunitiesShortlist';
import type { BestOpportunityRow } from '../../lib/bestOpportunityRows';

function row(overrides: Partial<BestOpportunityRow> = {}): BestOpportunityRow {
  return {
    candidateId: 'c1', rank: 1, symbol: 'AAPL', strategy: 'BPS', expiration: '2026-09-18', dte: 30,
    strikeSummary: '95/90', creditDebitLabel: '$1.50 credit', pop: 80, otmPct: 10, rocPct: 15,
    relevantLegOi: 500, opportunityScore: 85, decisionConfidence: 90, disposition: 'RECOMMENDED',
    primaryReason: 'Strong setup', supportingFactors: [], riskTradeoffs: [], portfolioConflicts: [],
    exposureDisclosures: [], rejectionReasons: [], missingInformationDisclosures: [], whatWouldImprove: [],
    ...overrides,
  };
}

describe('BestOpportunitiesShortlist', () => {
  it('shows at most the top 3 rows collapsed by default', () => {
    const rows = [1, 2, 3, 4, 5].map(n => row({ candidateId: `c${n}`, symbol: `SYM${n}`, rank: n }));
    render(<BestOpportunitiesShortlist rows={rows} />);
    expect(screen.getByText('SYM1')).toBeInTheDocument();
    expect(screen.getByText('SYM2')).toBeInTheDocument();
    expect(screen.getByText('SYM3')).toBeInTheDocument();
    expect(screen.queryByText('SYM4')).not.toBeInTheDocument();
    // Collapsed: detail text (primaryReason) is not rendered until expanded.
    expect(screen.queryByText('Strong setup')).not.toBeInTheDocument();
  });

  it('expands a row via its keyboard-operable aria-expanded button', () => {
    render(<BestOpportunitiesShortlist rows={[row()]} />);
    const button = screen.getByRole('button', { name: /view details/i });
    expect(button).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Strong setup')).toBeInTheDocument();
  });

  it('renders the exact required empty-state text when there are zero qualified opportunities', () => {
    render(<BestOpportunitiesShortlist rows={[]} />);
    expect(screen.getByText('No qualified opportunities for this scan. Review the disqualified candidates and their reasons below.')).toBeInTheDocument();
  });

  it('pickTopOpportunityIds returns only the visible top-N candidate ids', () => {
    const rows = [1, 2, 3, 4].map(n => row({ candidateId: `c${n}`, rank: n }));
    const ids = pickTopOpportunityIds(rows, 3);
    expect(ids.size).toBe(3);
    expect(ids.has('c1')).toBe(true);
    expect(ids.has('c4')).toBe(false);
  });
});
