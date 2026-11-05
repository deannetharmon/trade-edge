// features/screener/components/__tests__/TopOpportunityFrame.test.tsx
//
// SCAN-TOP-0002 -- one standard for "Best opportunity": a gold tab ON the card's top border (absolutely positioned, so it
// takes no space in the card's row and shifts no column), earned top picks only; the reasoning panel on any card with a row.

import React from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { TopOpportunityFrame } from '../TopOpportunityFrame';
import { RankedListHeader, RANKED_EMPTY_STATE_TEXT } from '../RankedListHeader';
import type { BestOpportunityRow } from '@/features/screener/lib/bestOpportunityRows';

const row = {
  candidateId: 'c1', resultKey: 'k1', rank: 1, symbol: 'AMD', strategy: 'BPS', expiration: '2026-12-04', dte: 32,
  strikeSummary: '430/425P', creditDebitLabel: '$142 credit', pop: 78, otmPct: 10.4, rocPct: 28, relevantLegOi: 980,
  opportunityScore: 81, decisionConfidence: 70, disposition: 'RECOMMEND' as any,
  primaryReason: 'Wide cushion for the credit.', supportingFactors: [], riskTradeoffs: [], portfolioConflicts: [],
  exposureDisclosures: [], rejectionReasons: [], missingInformationDisclosures: [], whatWouldImprove: [],
} as BestOpportunityRow;

describe('SCAN-TOP-0002 TopOpportunityFrame', () => {
  it('an earned top pick gets a gold tab that is absolutely positioned, so it adds nothing to the card row', () => {
    render(<TopOpportunityFrame rank={2}><div data-testid="card">card</div></TopOpportunityFrame>);
    const tab = screen.getByTestId('top-opportunity-marker');
    expect(tab).toHaveTextContent('BEST OPPORTUNITY #2');
    expect(tab.className).toContain('absolute');
    expect(tab.className).toContain('bg-amber-400');
    expect(screen.getByTestId('top-opportunity-frame')).toContainElement(screen.getByTestId('card'));
    expect(screen.getByTestId('top-opportunity-frame').className).toContain('ring-amber-400');
  });

  it('a card that has not earned it gets no tab and no outline, on every strategy', () => {
    render(<TopOpportunityFrame rank={null} row={row}><div>card</div></TopOpportunityFrame>);
    expect(screen.queryByTestId('top-opportunity-marker')).not.toBeInTheDocument();
    expect(screen.queryByTestId('top-opportunity-frame')).not.toBeInTheDocument();
  });

  it('the reasoning panel shows for any card with a row, tab or not, collapsed by default', () => {
    render(<TopOpportunityFrame rank={null} row={row}><div>card</div></TopOpportunityFrame>);
    expect(screen.getByRole('button', { name: /Why this ranks here/ })).toHaveAttribute('aria-expanded', 'false');
  });

  it('no row, no panel', () => {
    render(<TopOpportunityFrame rank={1}><div>card</div></TopOpportunityFrame>);
    expect(screen.queryByRole('button', { name: /Why this ranks here/ })).not.toBeInTheDocument();
  });
});

describe('SCAN-TOP-0002 RankedListHeader', () => {
  it('labels the ranked list when there are qualified cards', () => {
    render(<RankedListHeader hasQualified />);
    expect(screen.getByTestId('ranked-list-header')).toHaveTextContent(/ranked by score/i);
    expect(screen.queryByText(RANKED_EMPTY_STATE_TEXT)).not.toBeInTheDocument();
  });

  it('shows the required empty state when a completed scan has no qualified candidate', () => {
    render(<RankedListHeader hasQualified={false} />);
    expect(screen.getByText(RANKED_EMPTY_STATE_TEXT)).toBeInTheDocument();
  });
});

describe('RankedListHeader rankedBy', () => {
  it('says what the list is ordered by when told (covered calls rank by yield)', () => {
    render(<RankedListHeader hasQualified rankedBy="annualized yield" />);
    expect(screen.getByTestId('ranked-list-header')).toHaveTextContent(/ranked by annualized yield/i);
  });
});
