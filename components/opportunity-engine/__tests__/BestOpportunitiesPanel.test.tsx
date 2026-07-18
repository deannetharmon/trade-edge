// components/opportunity-engine/__tests__/BestOpportunitiesPanel.test.tsx
//
// OE-0001 / Product Owner correction: component-level coverage for the
// read-only Best Opportunities panel. This component is intentionally NOT
// mounted anywhere in production yet (see the component's own top-of-file
// comment and docs/design/OE-0001-Opportunity-Engine-Foundation.md
// section 7) -- these tests exist so the finished, reusable building
// block is proven correct and safe (purely presentational, no execution
// or mutation surface) independent of when it eventually gets mounted.

import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { THEMES } from '@/lib/theme';
import { BestOpportunitiesPanel } from '../BestOpportunitiesPanel';
import type { OpportunityRecommendation } from '@/lib/opportunity-engine';

function makeRecommendation(overrides: Partial<OpportunityRecommendation> = {}): OpportunityRecommendation {
  return {
    candidateId: 'cand_1',
    source: 'screener',
    symbol: 'AAPL',
    strategy: 'BPS',
    rank: 1,
    disposition: 'RECOMMENDED',
    opportunityScoreTotal: 72,
    decisionConfidenceTotal: 80,
    primaryReason: 'Strong credit ratio and probability of profit.',
    supportingFactors: [],
    riskTradeoffs: [],
    portfolioConflicts: [],
    exposureDisclosures: [],
    rejectionReasons: [],
    missingInformationDisclosures: [],
    whatWouldImprove: [],
    decisionAnalysisId: 'decision_1',
    ruleIds: [],
    ...overrides,
  };
}

describe('BestOpportunitiesPanel', () => {
  it('renders the empty state when given no recommendations', () => {
    render(<BestOpportunitiesPanel recommendations={[]} th={THEMES.dark} />);
    expect(screen.getByText('No ranked opportunities to display.')).toBeInTheDocument();
  });

  it('renders populated recommendations in the order given (rank order), never re-sorting them itself', () => {
    const recs = [
      makeRecommendation({ candidateId: 'cand_aapl', symbol: 'AAPL', rank: 1 }),
      makeRecommendation({ candidateId: 'cand_msft', symbol: 'MSFT', rank: 2 }),
      makeRecommendation({ candidateId: 'cand_googl', symbol: 'GOOGL', rank: 3 }),
    ];
    render(<BestOpportunitiesPanel recommendations={recs} th={THEMES.dark} />);

    const symbols = screen.getAllByText(/^(AAPL|MSFT|GOOGL)$/).map((el) => el.textContent);
    expect(symbols).toEqual(['AAPL', 'MSFT', 'GOOGL']);
  });

  it('renders each disposition with its correct label', () => {
    const recs = [
      makeRecommendation({ candidateId: 'c1', symbol: 'AAPL', disposition: 'RECOMMENDED' }),
      makeRecommendation({ candidateId: 'c2', symbol: 'MSFT', disposition: 'ACCEPTABLE_ALTERNATIVE' }),
      makeRecommendation({ candidateId: 'c3', symbol: 'GOOGL', disposition: 'WATCH' }),
      makeRecommendation({ candidateId: 'c4', symbol: 'TSLA', disposition: 'REJECTED' }),
    ];
    render(<BestOpportunitiesPanel recommendations={recs} th={THEMES.dark} />);

    expect(screen.getByText('Recommended')).toBeInTheDocument();
    expect(screen.getByText('Acceptable Alternative')).toBeInTheDocument();
    expect(screen.getByText('Watch')).toBeInTheDocument();
    expect(screen.getByText('Rejected')).toBeInTheDocument();
  });

  it('renders an all-rejected list correctly, with every card showing REJECTED and no other disposition label', () => {
    const recs = [
      makeRecommendation({ candidateId: 'c1', symbol: 'AAPL', disposition: 'REJECTED', rejectionReasons: ['Earnings risk within expiration.'] }),
      makeRecommendation({ candidateId: 'c2', symbol: 'MSFT', disposition: 'REJECTED', rejectionReasons: ['Insufficient buying power.'] }),
    ];
    render(<BestOpportunitiesPanel recommendations={recs} th={THEMES.dark} />);

    expect(screen.getAllByText('Rejected')).toHaveLength(2);
    expect(screen.queryByText('Recommended')).not.toBeInTheDocument();
    expect(screen.queryByText('Watch')).not.toBeInTheDocument();
    expect(screen.getByText('Earnings risk within expiration.', { exact: false })).toBeInTheDocument();
    expect(screen.getByText('Insufficient buying power.', { exact: false })).toBeInTheDocument();
  });

  it('renders the primary reason and the canonical opportunity score / decision confidence verbatim', () => {
    const rec = makeRecommendation({ primaryReason: 'High credit ratio with favorable probability of profit.', opportunityScoreTotal: 91, decisionConfidenceTotal: 87.6 });
    render(<BestOpportunitiesPanel recommendations={[rec]} th={THEMES.dark} />);

    expect(screen.getByText('High credit ratio with favorable probability of profit.')).toBeInTheDocument();
    expect(screen.getByText('91')).toBeInTheDocument();
    expect(screen.getByText('88')).toBeInTheDocument(); // 87.6 rounds to 88 via toFixed(0)
  });

  it('renders null opportunityScoreTotal as a clean placeholder, never as "null" or "NaN"', () => {
    const rec = makeRecommendation({ opportunityScoreTotal: null });
    render(<BestOpportunitiesPanel recommendations={[rec]} th={THEMES.dark} />);

    expect(screen.queryByText('null')).not.toBeInTheDocument();
    expect(screen.queryByText('NaN')).not.toBeInTheDocument();
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('renders portfolio conflicts (disposition-changing) distinctly from exposure disclosures (informational)', () => {
    const rec = makeRecommendation({
      disposition: 'ACCEPTABLE_ALTERNATIVE',
      portfolioConflicts: ['An existing open position already matches AAPL BPS exp 2026-08-21.'],
      exposureDisclosures: ['Existing AAPL exposure of $1,000 is already on the books.'],
    });
    render(<BestOpportunitiesPanel recommendations={[rec]} th={THEMES.dark} />);

    expect(screen.getByText('An existing open position already matches AAPL BPS exp 2026-08-21.', { exact: false })).toBeInTheDocument();
    expect(screen.getByText('Existing AAPL exposure of $1,000 is already on the books.', { exact: false })).toBeInTheDocument();
  });

  it('renders rejection reasons', () => {
    const rec = makeRecommendation({ disposition: 'REJECTED', rejectionReasons: ['The option expires after a scheduled earnings event.'] });
    render(<BestOpportunitiesPanel recommendations={[rec]} th={THEMES.dark} />);

    expect(screen.getByText('The option expires after a scheduled earnings event.', { exact: false })).toBeInTheDocument();
  });

  it('renders missing-information disclosures', () => {
    const rec = makeRecommendation({ missingInformationDisclosures: ['Sector is unknown for this candidate -- sector concentration cannot be fully verified.'] });
    render(<BestOpportunitiesPanel recommendations={[rec]} th={THEMES.dark} />);

    expect(screen.getByText('Sector is unknown for this candidate -- sector concentration cannot be fully verified.', { exact: false })).toBeInTheDocument();
  });

  it('renders "what would improve" content', () => {
    const rec = makeRecommendation({ whatWouldImprove: ['$500 more available capital would make this affordable.'] });
    render(<BestOpportunitiesPanel recommendations={[rec]} th={THEMES.dark} />);

    expect(screen.getByText(/Would improve with:/)).toBeInTheDocument();
    expect(screen.getByText(/\$500 more available capital would make this affordable\./)).toBeInTheDocument();
  });

  it('renders the supplied blockerNotice when provided', () => {
    render(<BestOpportunitiesPanel recommendations={[]} th={THEMES.dark} blockerNotice="Not yet connected to a live candidate source." />);
    expect(screen.getByText('Not yet connected to a live candidate source.')).toBeInTheDocument();
  });

  it('contains no Trade, Execute, Submit, Auto-Trade, order, or position-mutation control of any kind', () => {
    const recs = [
      makeRecommendation({ disposition: 'RECOMMENDED' }),
      makeRecommendation({ candidateId: 'c2', disposition: 'ACCEPTABLE_ALTERNATIVE' }),
      makeRecommendation({ candidateId: 'c3', disposition: 'WATCH' }),
      makeRecommendation({ candidateId: 'c4', disposition: 'REJECTED' }),
    ];
    const { container } = render(<BestOpportunitiesPanel recommendations={recs} th={THEMES.dark} />);

    // No interactive controls of any kind -- this is a pure display surface.
    expect(container.querySelectorAll('button, input, select, textarea, form, a')).toHaveLength(0);

    const text = container.textContent ?? '';
    for (const forbidden of ['Trade', 'Execute', 'Submit', 'Auto-Trade', 'AutoTrade', 'Order', 'Buy', 'Sell', 'Place', 'Confirm']) {
      expect(text).not.toMatch(new RegExp(forbidden, 'i'));
    }
  });

  it('performs no fetch of any kind -- it is a pure function of its props', () => {
    const fetchSpy = vi.fn();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    try {
      const recs = [makeRecommendation()];
      render(<BestOpportunitiesPanel recommendations={recs} th={THEMES.dark} />);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('never re-ranks its input -- rendering order always matches the exact array order supplied, even if ranks/scores are out of order', () => {
    // Deliberately supply a batch that is NOT in rank or score order. If the
    // component performed its own ranking, this would come out sorted; since
    // it must be purely presentational, it renders in the given array order.
    const recs = [
      makeRecommendation({ candidateId: 'c_low', symbol: 'GOOGL', rank: 3, opportunityScoreTotal: 10 }),
      makeRecommendation({ candidateId: 'c_high', symbol: 'AAPL', rank: 1, opportunityScoreTotal: 99 }),
      makeRecommendation({ candidateId: 'c_mid', symbol: 'MSFT', rank: 2, opportunityScoreTotal: 50 }),
    ];
    render(<BestOpportunitiesPanel recommendations={recs} th={THEMES.dark} />);

    const symbols = screen.getAllByText(/^(AAPL|MSFT|GOOGL)$/).map((el) => el.textContent);
    expect(symbols).toEqual(['GOOGL', 'AAPL', 'MSFT']);
  });

  it('renders each recommendation card keyed by candidateId with its own rank badge', () => {
    const recs = [
      makeRecommendation({ candidateId: 'cand_a', symbol: 'AAPL', rank: 1 }),
      makeRecommendation({ candidateId: 'cand_b', symbol: 'MSFT', rank: 2 }),
    ];
    render(<BestOpportunitiesPanel recommendations={recs} th={THEMES.dark} />);

    expect(screen.getByText('#1')).toBeInTheDocument();
    expect(screen.getByText('#2')).toBeInTheDocument();
  });
});
