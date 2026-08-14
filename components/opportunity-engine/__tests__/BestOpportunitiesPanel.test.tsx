// components/opportunity-engine/__tests__/BestOpportunitiesPanel.test.tsx
//
// OE-0001 / Product Owner correction: component-level coverage for the
// read-only Best Opportunities panel. Per WA-0005 (docs/design/
// WA-0005-Opportunities-Workspace-CES.md section 22), this panel is now a
// live, mounted production surface on /screener and Mission Control's
// summary target -- these tests cover everything expressible purely
// through this component's own props: all-REJECTED presentation,
// WATCH/ACCEPTABLE_ALTERNATIVE-without-RECOMMENDED presentation, the
// Detailed tier's expansion/"Not available" behavior, the capital-
// limitation notice, confidence-unavailable rendering, and a panel-
// isolation empty-props safety test. Page-owned states (initial/not-run,
// state 2 vs. state 5, refresh/staleness-with-real-inputs) are covered by
// app/screener/__tests__/ instead, per the CES's corrected test-ownership
// split -- this component cannot construct those states from its own props
// alone.

import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { THEMES } from '@/lib/theme';
import { BestOpportunitiesPanel, CAPITAL_LIMITATION_NOTICE } from '../BestOpportunitiesPanel';
import type { OpportunityRecommendation } from '@/lib/opportunity-engine';
import type { OpportunityCandidateDetail } from '@/lib/command-center/opportunityCandidateDetails';

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

function makeDetail(overrides: Partial<OpportunityCandidateDetail> = {}): OpportunityCandidateDetail {
  return {
    decisionAnalysisId: 'decision_1',
    alternatives: [],
    reviewTriggers: [],
    expectedOutcome: { intent: 'income' },
    concerns: [],
    rulesEvaluated: [],
    rulesBlocked: [],
    ...overrides,
  };
}

describe('BestOpportunitiesPanel', () => {
  it('renders the empty state when given no recommendations, with no capital-limitation notice', () => {
    render(<BestOpportunitiesPanel recommendations={[]} th={THEMES.dark} />);
    expect(screen.getByText('No ranked opportunities to display.')).toBeInTheDocument();
    expect(screen.queryByText(CAPITAL_LIMITATION_NOTICE)).not.toBeInTheDocument();
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

  it('all-REJECTED result (state 3): renders every REJECTED card with its rejectionReasons, never "nothing to display"', () => {
    const recs = [
      makeRecommendation({ candidateId: 'c1', symbol: 'AAPL', disposition: 'REJECTED', rejectionReasons: ['Earnings risk within expiration.'] }),
      makeRecommendation({ candidateId: 'c2', symbol: 'MSFT', disposition: 'REJECTED', rejectionReasons: ['Insufficient buying power.'] }),
    ];
    render(<BestOpportunitiesPanel recommendations={recs} th={THEMES.dark} />);

    expect(screen.getAllByText('Rejected')).toHaveLength(2);
    expect(screen.queryByText('Recommended')).not.toBeInTheDocument();
    expect(screen.queryByText('Watch')).not.toBeInTheDocument();
    expect(screen.queryByText('No ranked opportunities to display.')).not.toBeInTheDocument();
    expect(screen.getByText('Earnings risk within expiration.', { exact: false })).toBeInTheDocument();
    expect(screen.getByText('Insufficient buying power.', { exact: false })).toBeInTheDocument();
  });

  it('WATCH/ACCEPTABLE_ALTERNATIVE-without-RECOMMENDED (state 4): renders normally, with the capital-limitation notice as the only messaging tied to the absence', () => {
    const recs = [
      makeRecommendation({ candidateId: 'c1', symbol: 'AAPL', disposition: 'WATCH' }),
      makeRecommendation({ candidateId: 'c2', symbol: 'MSFT', disposition: 'ACCEPTABLE_ALTERNATIVE' }),
    ];
    render(<BestOpportunitiesPanel recommendations={recs} th={THEMES.dark} />);

    expect(screen.getByText('Watch')).toBeInTheDocument();
    expect(screen.getByText('Acceptable Alternative')).toBeInTheDocument();
    expect(screen.queryByText('Recommended')).not.toBeInTheDocument();
    expect(screen.getByText(CAPITAL_LIMITATION_NOTICE)).toBeInTheDocument();

    const text = screen.getByText(CAPITAL_LIMITATION_NOTICE).closest('div')?.parentElement?.textContent ?? '';
    expect(text).not.toMatch(/no recommendable trades exist|nothing qualifies|no suitable candidates/i);
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

  it('confidence-unavailable: missing/null decisionConfidenceTotal renders "confidence unavailable," never coerced to 0', () => {
    const rec = makeRecommendation({ decisionConfidenceTotal: null as unknown as number });
    render(<BestOpportunitiesPanel recommendations={[rec]} th={THEMES.dark} />);

    expect(screen.getByText('confidence unavailable')).toBeInTheDocument();
    expect(screen.queryByText('0')).not.toBeInTheDocument();
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

  it('renders the supplied blockerNotice when provided, via role="status"', () => {
    render(<BestOpportunitiesPanel recommendations={[]} th={THEMES.dark} blockerNotice="Not yet connected to a live candidate source." />);
    const notice = screen.getByText('Not yet connected to a live candidate source.');
    expect(notice).toBeInTheDocument();
    expect(notice.closest('[role="status"]')).toBeInTheDocument();
  });

  it('capital-limitation notice: renders the exact frozen copy, persistent (non-dismissible), via role="status", whenever recommendations.length > 0', () => {
    render(<BestOpportunitiesPanel recommendations={[makeRecommendation()]} th={THEMES.dark} />);
    const notice = screen.getByText(CAPITAL_LIMITATION_NOTICE);
    expect(notice).toBeInTheDocument();
    expect(notice.closest('[role="status"]')).toBeInTheDocument();
    // Non-dismissible: no button anywhere near the notice.
    expect(notice.closest('div')?.querySelector('button')).toBeNull();
  });

  it('capital-limitation notice does not render when recommendations is empty', () => {
    render(<BestOpportunitiesPanel recommendations={[]} th={THEMES.dark} />);
    expect(screen.queryByText(CAPITAL_LIMITATION_NOTICE, { exact: false })).not.toBeInTheDocument();
  });

  it('staleness: non-color-only stale indicator (icon + text) renders via role="status" when stale=true, and results remain visible', () => {
    const rec = makeRecommendation();
    render(<BestOpportunitiesPanel recommendations={[rec]} th={THEMES.dark} stale />);
    const staleNotice = screen.getByText(/Superseded by a newer scan/);
    expect(staleNotice).toBeInTheDocument();
    expect(staleNotice.closest('[role="status"]')).toBeInTheDocument();
    expect(screen.getByText('AAPL')).toBeInTheDocument();
  });

  it('does not render a stale indicator when stale is false/undefined', () => {
    render(<BestOpportunitiesPanel recommendations={[makeRecommendation()]} th={THEMES.dark} />);
    expect(screen.queryByText(/Superseded by a newer scan/)).not.toBeInTheDocument();
  });

  it('Detailed tier: collapsed by default, expandable via aria-expanded, and does not force-relocate focus', () => {
    render(<BestOpportunitiesPanel recommendations={[makeRecommendation()]} th={THEMES.dark} />);
    const toggle = screen.getByRole('button', { name: /Show Details/i });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');

    toggle.focus();
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    // Not a modal/drawer -- expanding must not force-relocate focus away
    // from the trigger that was just activated.
    expect(document.activeElement).toBe(toggle);

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });

  it('Detailed tier: renders "Not available" for every field when no candidateDetails entry exists for a candidate', () => {
    render(<BestOpportunitiesPanel recommendations={[makeRecommendation()]} th={THEMES.dark} />);
    fireEvent.click(screen.getByRole('button', { name: /Show Details/i }));

    expect(screen.getAllByText('Not available').length).toBeGreaterThan(0);
  });

  it('Detailed tier: renders truthfully-available canonical fields from the candidateDetails index', () => {
    const rec = makeRecommendation({ decisionAnalysisId: 'decision_42' });
    const details = {
      decision_42: makeDetail({
        decisionAnalysisId: 'decision_42',
        expiration: '2026-08-21',
        dte: 27,
        underlyingPrice: 190.5,
        credit: 1.2,
        capitalRequirement: 380,
        roc: 24,
        pop: 78,
      }),
    };
    render(<BestOpportunitiesPanel recommendations={[rec]} th={THEMES.dark} candidateDetails={details} />);
    fireEvent.click(screen.getByRole('button', { name: /Show Details/i }));

    expect(screen.getByText('2026-08-21')).toBeInTheDocument();
    expect(screen.getByText('27')).toBeInTheDocument();
    expect(screen.getByText('$190.50')).toBeInTheDocument();
    expect(screen.getByText('$1.20')).toBeInTheDocument();
    expect(screen.getByText('$380.00')).toBeInTheDocument();
    expect(screen.getByText('24%')).toBeInTheDocument();
    expect(screen.getByText('78%')).toBeInTheDocument();
  });

  it('Detailed tier: never fabricates a value -- an individually-missing optional field within a present detail entry still renders "Not available"', () => {
    const rec = makeRecommendation({ decisionAnalysisId: 'decision_42' });
    const details = { decision_42: makeDetail({ decisionAnalysisId: 'decision_42', expiration: '2026-08-21' }) };
    render(<BestOpportunitiesPanel recommendations={[rec]} th={THEMES.dark} candidateDetails={details} />);
    fireEvent.click(screen.getByRole('button', { name: /Show Details/i }));

    expect(screen.getByText('2026-08-21')).toBeInTheDocument();
    // underlyingPrice was never supplied on this detail entry.
    expect(screen.getAllByText('Not available').length).toBeGreaterThan(0);
  });

  it('genuinely-supplied empty recommendation presentation: does not crash or fabricate content when passed recommendations=[] directly', () => {
    expect(() => render(<BestOpportunitiesPanel recommendations={[]} th={THEMES.dark} />)).not.toThrow();
    expect(screen.getByText('No ranked opportunities to display.')).toBeInTheDocument();
  });

  it('contains no execution/order-submission affordance -- Trade, Execute, Submit, Auto-Trade, order, or position-mutation control of any kind. The Detailed-tier expand/collapse toggle is the only interactive control.', () => {
    const recs = [
      makeRecommendation({ disposition: 'RECOMMENDED' }),
      makeRecommendation({ candidateId: 'c2', disposition: 'ACCEPTABLE_ALTERNATIVE' }),
      makeRecommendation({ candidateId: 'c3', disposition: 'WATCH' }),
      makeRecommendation({ candidateId: 'c4', disposition: 'REJECTED' }),
    ];
    const { container } = render(<BestOpportunitiesPanel recommendations={recs} th={THEMES.dark} />);

    // Only the Detailed-tier expand/collapse buttons are interactive; no
    // input/select/textarea/form/anchor of any kind, and no execution/order
    // button of any kind.
    expect(container.querySelectorAll('input, select, textarea, form, a')).toHaveLength(0);
    const buttons = Array.from(container.querySelectorAll('button'));
    expect(buttons).toHaveLength(recs.length);
    for (const button of buttons) {
      expect(button.textContent ?? '').toMatch(/Show Details/);
    }

    const text = container.textContent ?? '';
    for (const forbidden of ['Trade', 'Execute', 'Submit', 'Auto-Trade', 'AutoTrade', 'Order', 'Buy', 'Sell', 'Place', 'Confirm']) {
      expect(text).not.toMatch(new RegExp(forbidden, 'i'));
    }
  });

  it('Finding 4: showCapitalNotice forces the notice on even when recommendations is empty (CES §15 states 2/5)', () => {
    render(<BestOpportunitiesPanel recommendations={[]} th={THEMES.dark} showCapitalNotice emptyStateMessage="Scan results existed, but the evaluation service produced no candidate analyses." />);
    expect(screen.getByText(CAPITAL_LIMITATION_NOTICE)).toBeInTheDocument();
    expect(screen.getByText('Scan results existed, but the evaluation service produced no candidate analyses.')).toBeInTheDocument();
    expect(screen.queryByText('No ranked opportunities to display.')).not.toBeInTheDocument();
  });

  it('Finding 4: showCapitalNotice=false suppresses the notice even when recommendations is non-empty', () => {
    render(<BestOpportunitiesPanel recommendations={[makeRecommendation()]} th={THEMES.dark} showCapitalNotice={false} />);
    expect(screen.queryByText(CAPITAL_LIMITATION_NOTICE)).not.toBeInTheDocument();
  });

  it('Finding 3: partial-evaluation banner renders only when skippedCount > 0, discloses the counts, and preserves the successfully-evaluated candidates below', () => {
    render(
      <BestOpportunitiesPanel
        recommendations={[makeRecommendation()]}
        th={THEMES.dark}
        partialEvaluation={{ skippedCount: 2, totalSubmitted: 5 }}
      />,
    );
    expect(screen.getByText(/Partial evaluation: 2 of 5 scan results could not be evaluated/)).toBeInTheDocument();
    expect(screen.getByText('AAPL')).toBeInTheDocument();
  });

  it('Finding 3: no partial-evaluation banner renders when partialEvaluation is omitted or skippedCount is 0 -- never fabricated', () => {
    render(<BestOpportunitiesPanel recommendations={[makeRecommendation()]} th={THEMES.dark} />);
    expect(screen.queryByText(/Partial evaluation/)).not.toBeInTheDocument();

    render(<BestOpportunitiesPanel recommendations={[makeRecommendation()]} th={THEMES.dark} partialEvaluation={{ skippedCount: 0, totalSubmitted: 5 }} />);
    expect(screen.queryAllByText(/Partial evaluation/)).toHaveLength(0);
  });

  it('Finding 6: a genuine evaluation failure (blockerNoticeIsError) renders via role="alert", never role="status"', () => {
    render(<BestOpportunitiesPanel recommendations={[]} th={THEMES.dark} blockerNotice="Unable to load ranked opportunities." blockerNoticeIsError />);
    const notice = screen.getByText('Unable to load ranked opportunities.');
    expect(notice.closest('[role="alert"]')).toBeInTheDocument();
    expect(notice.closest('[role="status"]')).toBeNull();
  });

  it('Finding 6: a non-error blockerNotice (loading) still renders via role="status"', () => {
    render(<BestOpportunitiesPanel recommendations={[]} th={THEMES.dark} blockerNotice="Ranking opportunities from these scan results…" />);
    const notice = screen.getByText('Ranking opportunities from these scan results…');
    expect(notice.closest('[role="status"]')).toBeInTheDocument();
    expect(notice.closest('[role="alert"]')).toBeNull();
  });

  it('Finding 6: the Detailed-tier expand/collapse trigger meets the 44x44 CSS-pixel minimum touch-target size', () => {
    render(<BestOpportunitiesPanel recommendations={[makeRecommendation()]} th={THEMES.dark} />);
    const toggle = screen.getByRole('button', { name: /Show Details/i });
    expect(toggle.className).toMatch(/min-h-\[44px\]/);
    expect(toggle.className).toMatch(/min-w-\[44px\]/);
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
